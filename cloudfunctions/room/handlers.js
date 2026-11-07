/**
 * room 云函数处理器 — 牌局生命周期
 * 处理器签名：async handler(payload, ctx)
 * ctx = { openid, roomRepo, userRepo, entryRepo, computeSettlement, now, log }
 * 仓储封装原子操作并返回状态枚举，错误判定集中在此，便于内存测试注入
 */

const crypto = require('crypto')

// 本地优先解析项目根 shared/ 与 _shared/（与测试共享同一 AppError 类实例，instanceof 才可靠）；
// 部署后包外无这些路径，回退到包内同步副本 ./shared/
function loadShared(name) {
  try {
    return require('../../shared/' + name)
  } catch (_) {
    return require('./shared/' + name)
  }
}
function loadInfra(name) {
  try {
    return require('../_shared/' + name)
  } catch (_) {
    return require('./shared/' + name)
  }
}

const { AppError, ErrorCodes } = loadShared('errors')
const { normalizeCode, isValidCodeFormat, generateCode } = loadShared('invite-code')
const { canAddEntry, canEndRoom, canInvite, canDeleteRoom } = loadShared('permissions')
const { MAX_MEMBERS, ROOM_STATUS_ACTIVE, ROOM_STATUS_ENDED, PAGE_SIZE_ROOMS } = loadShared('constants')
const { formatEntry, nicknameOf } = loadInfra('entry-format')

const NAME_MAX = 30
const REQ_ID_MAX = 64
const INVITE_RETRY = 5
const RECENT_ENTRIES = 20
const SETTLEMENT_BATCH = 100

/**
 * 默认随机源：crypto.randomInt(min, max) -> [min, max) 均匀整数。
 * 必须是双参形式：generateCode 依 rng.length>=2 走整数分支；
 * 若误写成无参返回整数索引，会被当 [0,1) 浮点放大取模后恒为 0（历史 bug：邀请码恒为 222222）。
 * 测试可注入 ctx.rng。
 */
function defaultRng(min, max) {
  return crypto.randomInt(min, max)
}

/**
 * 房间摘要（对外）
 */
function toSummary(room) {
  return {
    roomId: room._id,
    name: room.name,
    inviteCode: room.inviteCode,
    status: room.status,
    memberCount: room.memberOpenids.length,
    createdAt: room.createdAt,
    endedAt: room.endedAt == null ? null : room.endedAt
  }
}

function requireOpenid(ctx) {
  if (!ctx || !ctx.openid) {
    throw new AppError(ErrorCodes.UNAUTHENTICATED, 'UNAUTHENTICATED')
  }
}

// ── create ──────────────────────────────────────────────
async function create(payload, ctx) {
  requireOpenid(ctx)
  const p = payload || {}

  // 名称可选（v1.4 起创建不再输入名称）：缺省/空白存空串，超长仍拒绝
  const name = typeof p.name === 'string' ? p.name.trim() : ''
  if (name.length > NAME_MAX) {
    throw new AppError(ErrorCodes.INVALID_PARAM, 'INVALID_PARAM')
  }
  const clientRequestId = p.clientRequestId
  if (!clientRequestId || typeof clientRequestId !== 'string' || clientRequestId.length > REQ_ID_MAX) {
    throw new AppError(ErrorCodes.INVALID_PARAM, 'INVALID_PARAM')
  }

  // 权限：昵称非空
  const owner = await ctx.userRepo.findByOpenid(ctx.openid)
  if (!owner || !owner.nickname) {
    throw new AppError(ErrorCodes.PROFILE_INCOMPLETE, 'PROFILE_INCOMPLETE')
  }

  // 幂等：同 ownerOpenid + clientRequestId 直接返回
  const existing = await ctx.roomRepo.findByIdempotency(ctx.openid, clientRequestId)
  if (existing) {
    return { room: toSummary(existing), idempotent: true }
  }

  const roomBase = {
    name,
    ownerOpenid: ctx.openid,
    memberOpenids: [ctx.openid],
    members: [{ openid: ctx.openid, joinedAt: ctx.now() }],
    status: ROOM_STATUS_ACTIVE,
    createdByRequestId: clientRequestId,
    createdAt: ctx.now(),
    updatedAt: ctx.now(),
    endedAt: null
  }

  // 生成邀请码，唯一索引冲突重试至多 5 次
  const rng = ctx.rng || defaultRng
  let lastErr = null
  for (let attempt = 0; attempt < INVITE_RETRY; attempt++) {
    const inviteCode = generateCode(rng)
    try {
      const created = await ctx.roomRepo.createRoom({ ...roomBase, inviteCode })
      return { room: toSummary(created) }
    } catch (err) {
      if (err && err.conflict === 'inviteCode') {
        lastErr = err
        continue
      }
      if (err && err.conflict === 'idempotencyKey') {
        // 并发重试命中同一幂等键，重查返回
        const raced = await ctx.roomRepo.findByIdempotency(ctx.openid, clientRequestId)
        if (raced) return { room: toSummary(raced), idempotent: true }
      }
      throw err
    }
  }
  throw new AppError(ErrorCodes.INTERNAL_ERROR, 'failed to generate unique invite code', {
    reason: lastErr && lastErr.message
  })
}

// ── join ────────────────────────────────────────────────
async function join(payload, ctx) {
  requireOpenid(ctx)
  const rawCode = (payload || {}).inviteCode
  const code = normalizeCode(rawCode)
  if (!isValidCodeFormat(code)) {
    throw new AppError(ErrorCodes.INVALID_INVITE_CODE_FORMAT, 'INVALID_INVITE_CODE_FORMAT')
  }

  const found = await ctx.roomRepo.findByInviteCode(code)
  if (!found) {
    throw new AppError(ErrorCodes.INVALID_INVITE_CODE, 'INVALID_INVITE_CODE')
  }

  const result = await ctx.roomRepo.appendMember(found._id, ctx.openid, ctx.now())

  switch (result.status) {
    case 'already-member':
      return { room: toSummary(result.room), alreadyMember: true }
    case 'ended':
      throw new AppError(ErrorCodes.ROOM_ENDED, 'ROOM_ENDED')
    case 'full':
      throw new AppError(ErrorCodes.ROOM_FULL, 'ROOM_FULL')
    case 'joined':
      return { room: toSummary(result.room), alreadyMember: false }
    default:
      throw new AppError(ErrorCodes.INTERNAL_ERROR, 'unexpected join status')
  }
}

// ── list ────────────────────────────────────────────────
async function list(payload, ctx) {
  requireOpenid(ctx)
  const p = payload || {}
  const page = Number.isInteger(p.page) && p.page >= 0 ? p.page : 0
  const pageSize = Math.min(
    Number.isInteger(p.pageSize) && p.pageSize > 0 ? p.pageSize : PAGE_SIZE_ROOMS,
    50
  )

  // 多取 1 条判断 hasMore
  const rows = await ctx.roomRepo.listByMember(ctx.openid, page * pageSize, pageSize + 1)
  const hasMore = rows.length > pageSize
  const items = rows.slice(0, pageSize).map(toSummary)
  return { items, page, hasMore }
}

// ── detail ──────────────────────────────────────────────
async function detail(payload, ctx) {
  requireOpenid(ctx)
  const roomId = (payload || {}).roomId
  if (!roomId) throw new AppError(ErrorCodes.INVALID_PARAM, 'INVALID_PARAM')

  const room = await ctx.roomRepo.findById(roomId)
  if (!room) throw new AppError(ErrorCodes.ROOM_NOT_FOUND, 'ROOM_NOT_FOUND')
  if (!room.memberOpenids.includes(ctx.openid)) {
    throw new AppError(ErrorCodes.NOT_ROOM_MEMBER, 'NOT_ROOM_MEMBER')
  }

  // 成员资料
  const users = await ctx.userRepo.findManyByOpenids(room.memberOpenids)
  const usersById = new Map(users.map((u) => [u.openid, u]))
  const members = room.members.map((m) => {
    const u = usersById.get(m.openid)
    return {
      openid: m.openid,
      nickname: nicknameOf(u, m.openid),
      avatarFileID: (u && u.avatarFileID) || '',
      joinedAt: m.joinedAt
    }
  })

  // 分页读取全部流水 → 计算结算
  const entries = await collectAllEntries(ctx, roomId)
  const settlementRaw = ctx.computeSettlement(entries, room.members)
  const settlement = settlementRaw.map((s) => {
    const u = usersById.get(s.openid)
    return {
      openid: s.openid,
      nickname: nicknameOf(u, s.openid),
      avatarFileID: (u && u.avatarFileID) || '',
      totalCents: s.totalCents
    }
  })

  // 最近 20 条流水
  const recent = entries.slice(0, RECENT_ENTRIES).map((e) => formatEntry(e, usersById))

  return {
    room: {
      roomId: room._id,
      name: room.name,
      inviteCode: room.inviteCode,
      ownerOpenid: room.ownerOpenid,
      status: room.status,
      memberCount: room.memberOpenids.length,
      createdAt: room.createdAt,
      endedAt: room.endedAt == null ? null : room.endedAt
    },
    members,
    settlement,
    recentEntries: recent,
    permissions: {
      canAddEntry: canAddEntry(ctx.openid, room),
      canEndRoom: canEndRoom(ctx.openid, room),
      canInvite: canInvite(ctx.openid, room),
      canDeleteRoom: canDeleteRoom(ctx.openid, room)
    }
  }
}

async function collectAllEntries(ctx, roomId) {
  const all = []
  let cursor = null
  // 每批 SETTLEMENT_BATCH 条，直到取完
  for (;;) {
    const batch = await ctx.entryRepo.scanByRoom(roomId, cursor, SETTLEMENT_BATCH)
    all.push(...batch.items)
    if (!batch.hasMore) break
    cursor = batch.nextCursor
  }
  return all
}

// ── end ─────────────────────────────────────────────────
async function end(payload, ctx) {
  requireOpenid(ctx)
  const roomId = (payload || {}).roomId
  if (!roomId) throw new AppError(ErrorCodes.INVALID_PARAM, 'INVALID_PARAM')

  const room = await ctx.roomRepo.findById(roomId)
  if (!room) throw new AppError(ErrorCodes.ROOM_NOT_FOUND, 'ROOM_NOT_FOUND')
  if (room.ownerOpenid !== ctx.openid) {
    throw new AppError(ErrorCodes.NOT_ROOM_OWNER, 'NOT_ROOM_OWNER')
  }

  const result = await ctx.roomRepo.endRoom(roomId, ctx.now())
  const r = result.room
  return {
    room: {
      roomId: r._id,
      status: r.status,
      endedAt: r.endedAt == null ? null : r.endedAt
    },
    alreadyEnded: result.status === 'already-ended'
  }
}

// ── remove（删除牌局记录）───────────────────────────────
/**
 * 仅房主可删除；删除后牌局对所有成员不可见，其流水一并清除。
 * 顺序：先删房间文档（立即对所有成员生效），再尽力清除流水；
 * 流水清除失败不回滚（孤儿流水不可见，可重入重试清除）。
 */
async function remove(payload, ctx) {
  requireOpenid(ctx)
  const roomId = (payload || {}).roomId
  if (!roomId || typeof roomId !== 'string') {
    throw new AppError(ErrorCodes.INVALID_PARAM, 'INVALID_PARAM')
  }

  const room = await ctx.roomRepo.findById(roomId)
  if (!room) throw new AppError(ErrorCodes.ROOM_NOT_FOUND, 'ROOM_NOT_FOUND')
  if (room.ownerOpenid !== ctx.openid) {
    throw new AppError(ErrorCodes.NOT_ROOM_OWNER, 'NOT_ROOM_OWNER')
  }

  await ctx.roomRepo.removeById(roomId)

  let deletedEntries = 0
  try {
    deletedEntries = await ctx.entryRepo.deleteByRoom(roomId)
  } catch (err) {
    if (ctx.log && ctx.log.warn) {
      ctx.log.warn('delete entries after room removal failed', err && err.message)
    }
  }

  return { roomId, deleted: true, deletedEntries }
}

module.exports = { create, join, list, detail, end, remove, toSummary }
