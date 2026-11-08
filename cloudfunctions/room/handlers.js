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
const { MAX_MEMBERS, ROOM_STATUS_ACTIVE, ROOM_STATUS_ENDED, PAGE_SIZE_ROOMS, IDLE_AUTO_END_MS, IDLE_AUTO_END_BATCH, END_REASON_OWNER, END_REASON_IDLE } = loadShared('constants')
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
    endedAt: room.endedAt == null ? null : room.endedAt,
    ...activityFields(room)
  }
}

/**
 * v2.6 闲置自动结束相关字段（所有 room 出口统一附带）：
 * - lastActivityAt：有效活跃时间，历史数据无此字段时回退 max(createdAt, updatedAt)
 *   （join/记账都会推进 updatedAt/lastActivityAt，回退口径与扫描一致）
 * - autoEndAt：进行中房间「若无新活动将自动结束」的时间点；已结束房间为 null
 */
function activityFields(room) {
  const lastActivityAt = effectiveLastActivity(room)
  const autoEndAt = room.status === ROOM_STATUS_ACTIVE ? lastActivityAt + IDLE_AUTO_END_MS : null
  return { lastActivityAt, autoEndAt }
}

/** v2.6：房间的有效活跃时间（历史数据回退 max(createdAt, updatedAt)） */
function effectiveLastActivity(room) {
  return room.lastActivityAt != null
    ? room.lastActivityAt
    : Math.max(room.createdAt || 0, room.updatedAt || 0)
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
    lastActivityAt: ctx.now(), // v2.6：闲置自动结束的活跃基准（join/记账会推进）
    endedAt: null
  }

  // 生成邀请码（v2.0 起 4 位纯数字），唯一索引冲突重试至多 5 次；
  // 历史结束的牌局已归档释放码位，冲突仅来自进行中牌局
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
      endedAt: room.endedAt == null ? null : room.endedAt,
      endReason: room.endReason || null, // v2.6：历史结束的房间为 null，前端按「已结束」中性展示
      ...activityFields(room)
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

  const result = await ctx.roomRepo.endRoom(roomId, ctx.now(), END_REASON_OWNER)
  const r = result.room
  return {
    room: {
      roomId: r._id,
      status: r.status,
      endedAt: r.endedAt == null ? null : r.endedAt,
      endReason: r.endReason || null
    },
    alreadyEnded: result.status === 'already-ended'
  }
}

// ── autoEndIdle（v2.6：定时器触发的闲置自动结束，内部 action）────────
/**
 * 扫描进行中牌局，把有效活跃时间距今 ≥ IDLE_AUTO_END_MS（7 天）的自动结束。
 * 判据「活跃」= 无新增流水且无新成员加入；记账/加入都会推进 lastActivityAt。
 * 由定时器以 ctx.source='timer' 调用，不接受外部 action（前端无入口，见 6.5）。
 * 单轮最多处理 IDLE_AUTO_END_BATCH 场；每场走独立事务（endRoom），互不影响。
 * @returns {Promise<{scanned:number, ended:object[]}>} ended=[{roomId,inviteCode(归档后)}]
 */
async function autoEndIdle(payload, ctx) {
  // 仅定时器可触发：普通 callFunction 进来的 ctx 不带 source='timer'
  if (!ctx || ctx.source !== 'timer') {
    throw new AppError(ErrorCodes.UNAUTHENTICATED, 'autoEndIdle is timer-only')
  }
  const now = ctx.now()
  const cutoff = now - IDLE_AUTO_END_MS
  const active = await ctx.roomRepo.listActive()
  const ended = []
  // 按有效活跃时间升序取最闲置的，过滤出已过阈值的，单轮限量
  const idle = active
    .filter((r) => effectiveLastActivity(r) <= cutoff)
    .sort((a, b) => effectiveLastActivity(a) - effectiveLastActivity(b))
    .slice(0, IDLE_AUTO_END_BATCH)

  for (const room of idle) {
    const res = await ctx.roomRepo.endRoom(room._id, now, END_REASON_IDLE)
    if (res.status === 'ended') {
      ended.push({ roomId: room._id, inviteCode: res.room.inviteCode })
    }
    // already-ended / not-found：并发已被他人结束，跳过即可
  }
  ctx.log && ctx.log.info && ctx.log.info('autoEndIdle', { scanned: active.length, ended: ended.length })
  return { scanned: active.length, ended }
}

// ── remove（删除牌局记录）───────────────────────────────
/**
 * 仅房主可删除，且须已结束（v1.5：进行中返回 ROOM_NOT_ENDED，避免误删正在记录的账）。
 * 删除后牌局对所有成员不可见，其流水一并清除。
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
  if (room.status !== ROOM_STATUS_ENDED) {
    // v1.5：进行中的牌局须先结束再删除，避免误删正在记录的账
    throw new AppError(ErrorCodes.ROOM_NOT_ENDED, 'ROOM_NOT_ENDED')
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

module.exports = { create, join, list, detail, end, remove, autoEndIdle, toSummary }
