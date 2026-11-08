/**
 * 内存仓储 — 供云函数处理器测试注入，契约与真实 repositories.js 一致。
 * 事务类操作（appendMember/endRoom/createRoom 冲突）以原子同步内存操作模拟，
 * 并可注入冲突以测试重试路径。
 */

const { computeSettlement } = require('../../shared/settlement')
const { ROOM_STATUS_ACTIVE, ROOM_STATUS_ENDED, MAX_MEMBERS } = require('../../shared/constants')

let _seq = 0
function nextId(prefix) {
  _seq += 1
  return `${prefix}_${String(_seq).padStart(3, '0')}`
}

/** 用户仓储（内存） */
class FakeUserRepo {
  constructor() {
    this._data = new Map()
  }

  async findByOpenid(openid) {
    return this._data.get(openid) || null
  }

  /**
   * @param {string[]} openids
   * @returns {Promise<object[]>}
   */
  async findManyByOpenids(openids) {
    return openids.map((id) => this._data.get(id)).filter(Boolean)
  }

  async save(user) {
    this._data.set(user.openid, user)
    return user
  }

  async insert(user) {
    if (this._data.has(user.openid)) {
      const err = new Error('duplicate key')
      err.code = 'CONFLICT'
      throw err
    }
    this._data.set(user.openid, user)
    return user
  }

  async update(openid, fields) {
    const cur = this._data.get(openid)
    if (!cur) return null
    const next = { ...cur, ...fields }
    this._data.set(openid, next)
    return next
  }
}

/** 牌局仓储（内存） */
class FakeRoomRepo {
  constructor(opts = {}) {
    this._data = new Map()
    // 冲突注入：inviteCodesToConflict — 生成到这些码时抛冲突（测试 ROOM-04 重试）
    this._inviteCodesToConflict = new Set(opts.conflictInviteCodes || [])
    // 幂等键冲突注入（测试 create 并发重查路径）
    this._forceIdempotencyConflict = !!opts.forceIdempotencyConflict
  }

  async findById(roomId) {
    return this._data.get(roomId) || null
  }

  async findByInviteCode(code) {
    for (const room of this._data.values()) {
      if (room.inviteCode === code) return room
    }
    return null
  }

  async findByIdempotency(ownerOpenid, clientRequestId) {
    for (const room of this._data.values()) {
      if (room.ownerOpenid === ownerOpenid && room.createdByRequestId === clientRequestId) {
        return room
      }
    }
    return null
  }

  /**
   * 插入房间；邀请码或幂等键冲突时抛错（携带 conflict 字段）
   * @param {object} room - 不含 _id
   */
  async createRoom(room) {
    if (this._inviteCodesToConflict.has(room.inviteCode) || this._isInviteDup(room.inviteCode)) {
      const err = new Error('invite code conflict')
      err.conflict = 'inviteCode'
      throw err
    }
    if (this._forceIdempotencyConflict) {
      // 模拟并发：首次插入必抛幂等键冲突，重查时房间已存在
      const err = new Error('idempotency conflict')
      err.conflict = 'idempotencyKey'
      // 先写入以便 handler 重查命中
      const stored = { ...room, _id: room._id || nextId('r') }
      this._data.set(stored._id, stored)
      this._forceIdempotencyConflict = false
      throw err
    }
    const stored = { ...room, _id: room._id || nextId('r') }
    this._data.set(stored._id, stored)
    return stored
  }

  _isInviteDup(code) {
    for (const room of this._data.values()) {
      if (room.inviteCode === code) return true
    }
    return false
  }

  /**
   * 原子追加成员（模拟事务内重读）
   * @returns {Promise<{status:string, room:object}>}
   */
  async appendMember(roomId, openid, joinedAt) {
    const room = this._data.get(roomId)
    if (!room) return { status: 'not-found', room: null }
    if (room.memberOpenids.includes(openid)) {
      return { status: 'already-member', room }
    }
    if (room.status !== ROOM_STATUS_ACTIVE) {
      return { status: 'ended', room }
    }
    if (room.memberOpenids.length >= MAX_MEMBERS) {
      return { status: 'full', room }
    }
    const updated = {
      ...room,
      memberOpenids: [...room.memberOpenids, openid],
      members: [...room.members, { openid, joinedAt }],
      updatedAt: joinedAt,
      lastActivityAt: joinedAt // v2.6：加入推进活跃时间
    }
    this._data.set(roomId, updated)
    return { status: 'joined', room: updated }
  }

  /**
   * v2.6：列出进行中房间（按 updatedAt 升序，供闲置扫描）
   */
  async listActive() {
    return [...this._data.values()]
      .filter((r) => r.status === ROOM_STATUS_ACTIVE)
      .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))
  }

  /** v2.6：真实仓储中由 handlers.add 在事务提交后调用（非事务单文档更新，记账即活跃） */
  async bumpActivity(roomId, at) {
    const room = this._data.get(roomId)
    if (!room) return null
    const updated = { ...room, lastActivityAt: at, updatedAt: at }
    this._data.set(roomId, updated)
    return updated
  }

  /**
   * 成员维度分页，createdAt 倒序
   */
  async listByMember(openid, skip, limit) {
    const rows = [...this._data.values()]
      .filter((r) => r.memberOpenids.includes(openid))
      .sort((a, b) => b.createdAt - a.createdAt || (a._id < b._id ? 1 : -1))
    return rows.slice(skip, skip + limit)
  }

  /**
   * 结束牌局（模拟事务内校验 active）
   * v2.0：与真实仓储一致，结束时归档 inviteCode 释放数字码位（E:{roomId}）
   * @returns {Promise<{status:string, room:object}>}
   */
  async endRoom(roomId, now, reason) {
    const room = this._data.get(roomId)
    if (!room) return { status: 'not-found', room: null }
    if (room.status === ROOM_STATUS_ENDED) {
      return { status: 'already-ended', room }
    }
    const updated = {
      ...room,
      status: ROOM_STATUS_ENDED,
      endedAt: now,
      updatedAt: now,
      endReason: reason || 'owner', // v2.6
      inviteCode: `E:${roomId}`
    }
    this._data.set(roomId, updated)
    return { status: 'ended', room: updated }
  }

  /**
   * 删除房间（模拟 doc().remove()）
   * @returns {Promise<boolean>}
   */
  async removeById(roomId) {
    return this._data.delete(roomId)
  }

  /** 便捷种子（测试初始化用） */
  async seed(roomWithoutId) {
    const stored = { ...roomWithoutId, _id: roomWithoutId._id || nextId('r') }
    this._data.set(stored._id, stored)
    return stored
  }
}

/** 流水仓储（内存） */
class FakeEntryRepo {
  constructor(opts = {}) {
    this._data = []
    // createAtomically 需要读房间：注入 FakeRoomRepo 实例
    this._roomRepo = opts.roomRepo || null
    // 注入唯一索引冲突（模拟并发重试），消费一次后复位
    this._forceUniqueConflict = !!opts.forceUniqueConflict
  }

  async findByRoom(roomId) {
    return this._data.filter((e) => e.roomId === roomId)
  }

  /**
   * 幂等键查询：roomId + clientRequestId
   */
  async findByIdempotency(roomId, clientRequestId) {
    return this._data.find((e) => e.roomId === roomId && e.clientRequestId === clientRequestId) || null
  }

  /**
   * 模拟事务：重读房间 -> 校验回调（AppError 直接抛出并回滚）-> 插入
   * @param {{roomId:string, clientRequestId:string, createdBy:string, createdAt:number}} meta
   * @param {(room:object) => {fromOpenid:string,toOpenid:string,amountCents:number}} validateInRoom
   * @returns {Promise<{status:'created'|'duplicate'|'not-found', entry?:object}>}
   */
  async createAtomically(meta, validateInRoom) {
    const room = this._roomRepo ? await this._roomRepo.findById(meta.roomId) : null
    if (!room) return { status: 'not-found' }
    // 校验回调抛 AppError 即事务回滚，异常向上传播
    const doc = validateInRoom(room)
    if (await this.findByIdempotency(meta.roomId, meta.clientRequestId) || this._forceUniqueConflict) {
      this._forceUniqueConflict = false
      return { status: 'duplicate' }
    }
    const stored = { ...doc, roomId: meta.roomId, clientRequestId: meta.clientRequestId, createdBy: meta.createdBy, createdAt: meta.createdAt, _id: nextId('e') }
    this._data.push(stored)
    // v2.6 修正：活跃时间不在此推进（真实实现同样只在事务内插流水），
    // 由 handlers.add 提交后调用 roomRepo.bumpActivity，以免并发记账在 rooms 上撞事务写冲突
    return { status: 'created', entry: { ...stored } }
  }

  /**
   * 分页读取：createdAt 倒序，同毫秒 _id 倒序
   */
  async listByRoom(roomId, skip, limit) {
    const sorted = this._data
      .filter((e) => e.roomId === roomId)
      .sort((a, b) => b.createdAt - a.createdAt || (a._id < b._id ? 1 : -1))
    return sorted.slice(skip, skip + limit).map((e) => ({ ...e }))
  }

  /**
   * 游标扫描：createdAt 倒序，同毫秒按 _id 倒序
   * @param {string} roomId
   * @param {{createdAt:number,_id:string}|null} cursor
   * @param {number} batchSize
   */
  async scanByRoom(roomId, cursor, batchSize) {
    const sorted = this._data
      .filter((e) => e.roomId === roomId)
      .sort((a, b) => b.createdAt - a.createdAt || (a._id < b._id ? 1 : -1))
    let items = sorted
    if (cursor) {
      const idx = sorted.findIndex((e) => e._id === cursor._id)
      items = idx >= 0 ? sorted.slice(idx + 1) : sorted
    }
    const page = items.slice(0, batchSize)
    const hasMore = items.length > batchSize
    const nextCursor = page.length ? page[page.length - 1] : null
    return {
      items: page.map((e) => ({ ...e })),
      hasMore,
      nextCursor: nextCursor ? { createdAt: nextCursor.createdAt, _id: nextCursor._id } : null
    }
  }

  async insert(entry) {
    const stored = { ...entry, _id: entry._id || nextId('e') }
    this._data.push(stored)
    return stored
  }

  async seed(entry) {
    return this.insert(entry)
  }

  async countByRoom(roomId) {
    return this._data.filter((e) => e.roomId === roomId).length
  }

  /**
   * 批量清除某房间全部流水（模拟 where().remove()）
   * @returns {Promise<number>} 删除条数
   */
  async deleteByRoom(roomId) {
    const before = this._data.length
    this._data = this._data.filter((e) => e.roomId !== roomId)
    return before - this._data.length
  }
}

module.exports = { FakeUserRepo, FakeRoomRepo, FakeEntryRepo, computeSettlement }
