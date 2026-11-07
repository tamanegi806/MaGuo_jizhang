/**
 * entry 云函数处理器 — 流水新增与查询
 * 处理器签名：async handler(payload, ctx)
 * ctx = { openid, roomRepo, userRepo, entryRepo, now, log }
 */

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
const { normalizeEntry } = loadShared('entry')
const { ROOM_STATUS_ACTIVE, PAGE_SIZE_ENTRIES } = loadShared('constants')
const { formatEntry } = loadInfra('entry-format')

const REQ_ID_MAX = 64
const LIST_PAGE_MAX = 50

function requireOpenid(ctx) {
  if (!ctx || !ctx.openid) {
    throw new AppError(ErrorCodes.UNAUTHENTICATED, 'UNAUTHENTICATED')
  }
}

/**
 * add — 新增流水（幂等：roomId + clientRequestId）
 */
async function add(payload, ctx) {
  requireOpenid(ctx)
  const p = payload || {}

  if (!p.roomId || typeof p.roomId !== 'string') {
    throw new AppError(ErrorCodes.INVALID_PARAM, 'INVALID_PARAM')
  }
  if (
    typeof p.clientRequestId !== 'string' ||
    p.clientRequestId.length < 1 ||
    p.clientRequestId.length > REQ_ID_MAX
  ) {
    throw new AppError(ErrorCodes.INVALID_PARAM, 'INVALID_PARAM')
  }

  // 幂等预检：同 roomId + clientRequestId 已存在直接返回
  const existing = await ctx.entryRepo.findByIdempotency(p.roomId, p.clientRequestId)
  if (existing) {
    return { entry: await enrichEntry(ctx, existing), duplicated: true }
  }

  // 事务：重读房间 -> 状态/成员校验 -> normalize 校验 -> 插入
  // validateInRoom 抛出的 AppError 会中止事务并原样传播
  const result = await ctx.entryRepo.createAtomically(
    {
      roomId: p.roomId,
      clientRequestId: p.clientRequestId,
      createdBy: ctx.openid,
      createdAt: ctx.now()
    },
    (room) => {
      if (!room.memberOpenids.includes(ctx.openid)) {
        throw new AppError(ErrorCodes.NOT_ROOM_MEMBER, 'NOT_ROOM_MEMBER')
      }
      if (room.status !== ROOM_STATUS_ACTIVE) {
        throw new AppError(ErrorCodes.ROOM_ENDED, 'ROOM_ENDED')
      }
      return normalizeEntry(
        { fromOpenid: p.fromOpenid, toOpenid: p.toOpenid, amountCents: p.amountCents },
        { memberOpenids: room.memberOpenids }
      )
    }
  )

  if (result.status === 'not-found') {
    throw new AppError(ErrorCodes.ROOM_NOT_FOUND, 'ROOM_NOT_FOUND')
  }

  if (result.status === 'duplicate') {
    // 并发重试命中唯一索引：按幂等键重查返回
    const raced = await ctx.entryRepo.findByIdempotency(p.roomId, p.clientRequestId)
    if (!raced) {
      throw new AppError(ErrorCodes.INTERNAL_ERROR, 'entry duplicate race unresolved')
    }
    return { entry: await enrichEntry(ctx, raced), duplicated: true }
  }

  return { entry: await enrichEntry(ctx, result.entry), duplicated: false }
}

/**
 * list — 分页读取流水（已结束牌局仍可读）
 */
async function list(payload, ctx) {
  requireOpenid(ctx)
  const p = payload || {}

  if (!p.roomId || typeof p.roomId !== 'string') {
    throw new AppError(ErrorCodes.INVALID_PARAM, 'INVALID_PARAM')
  }
  const room = await ctx.roomRepo.findById(p.roomId)
  if (!room) throw new AppError(ErrorCodes.ROOM_NOT_FOUND, 'ROOM_NOT_FOUND')
  if (!room.memberOpenids.includes(ctx.openid)) {
    throw new AppError(ErrorCodes.NOT_ROOM_MEMBER, 'NOT_ROOM_MEMBER')
  }

  const page = Number.isInteger(p.page) && p.page >= 0 ? p.page : 0
  const pageSize = Math.min(
    Number.isInteger(p.pageSize) && p.pageSize > 0 ? p.pageSize : PAGE_SIZE_ENTRIES,
    LIST_PAGE_MAX
  )

  // 多取 1 条判断 hasMore；createdAt 倒序、同毫秒 _id 倒序
  const rows = await ctx.entryRepo.listByRoom(p.roomId, page * pageSize, pageSize + 1)
  const hasMore = rows.length > pageSize
  const items = rows.slice(0, pageSize)

  const usersById = await loadUsersFor(ctx, items)
  return {
    items: items.map((e) => formatEntry(e, usersById)),
    page,
    hasMore
  }
}

/** 关联单条流水双方资料后格式化 */
async function enrichEntry(ctx, entry) {
  const usersById = await loadUsersFor(ctx, [entry])
  return formatEntry(entry, usersById)
}

/** 批量读取流水涉及的付款人/收款人资料 */
async function loadUsersFor(ctx, entries) {
  const openids = []
  for (const e of entries) {
    if (!openids.includes(e.fromOpenid)) openids.push(e.fromOpenid)
    if (!openids.includes(e.toOpenid)) openids.push(e.toOpenid)
  }
  const users = openids.length ? await ctx.userRepo.findManyByOpenids(openids) : []
  return new Map(users.map((u) => [u.openid, u]))
}

module.exports = { add, list }
