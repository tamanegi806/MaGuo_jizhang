/**
 * room 云函数数据仓储 — 云数据库真实实现（含事务）
 * 契约与 tests/helpers/fake-repos.js 的 FakeRoomRepo 一致
 */

const COLLECTIONS = (() => {
  try {
    return require('./shared/constants')
  } catch (_) {
    return require('../../shared/constants')
  }
})()
const { MAX_MEMBERS } = COLLECTIONS

/** 清除流水的单次批量上限为 1000 条，最多循环 100 批（10 万条，理论不可达）防死循环 */
const DELETE_ENTRIES_MAX_BATCHES = 100

/**
 * @param {object} db - cloud.database()
 * @param {object} _ - db.command
 */
function createRepositories(db, _) {
  const rooms = db.collection(COLLECTIONS.COLLECTION_ROOMS)
  const entries = db.collection(COLLECTIONS.COLLECTION_ENTRIES)
  const users = db.collection(COLLECTIONS.COLLECTION_USERS)

  return {
    // ── 用户读（供 detail 关联成员资料）─────────────
    async findByOpenid(openid) {
      const res = await users.where({ openid }).limit(1).get()
      return res.data[0] || null
    },

    async findManyByOpenids(openids) {
      if (!openids.length) return []
      const res = await users.where({ openid: _.in(openids) }).get()
      return res.data
    },

    // ── 房间读 ──────────────────────────────
    async findById(roomId) {
      const res = await rooms.doc(roomId).get().catch(() => null)
      return res && res.data ? res.data : null
    },

    async findByInviteCode(code) {
      const res = await rooms.where({ inviteCode: code }).limit(1).get()
      return res.data[0] || null
    },

    async findByIdempotency(ownerOpenid, clientRequestId) {
      const res = await rooms
        .where({ ownerOpenid, createdByRequestId: clientRequestId })
        .limit(1)
        .get()
      return res.data[0] || null
    },

    /**
     * 插入房间；命中唯一索引时抛携带 conflict 字段的错误
     * 依赖：ownerOpenid+createdByRequestId 唯一索引、inviteCode 唯一索引
     */
    async createRoom(room) {
      try {
        const res = await rooms.add({ data: room })
        return { ...room, _id: res._id }
      } catch (err) {
        // 云数据库唯一索引冲突：err.errCode / errMsg 含 "duplicate" 或索引名
        if (isInviteConflict(err)) {
          const e = new Error('invite code conflict')
          e.conflict = 'inviteCode'
          throw e
        }
        if (isIdempotencyConflict(err)) {
          const e = new Error('idempotency conflict')
          e.conflict = 'idempotencyKey'
          throw e
        }
        throw err
      }
    },

    /**
     * 事务内原子追加成员
     * @returns {Promise<{status:string, room:object}>}
     */
    async appendMember(roomId, openid, joinedAt) {
      const transaction = await db.startTransaction()
      try {
        const room = await transaction.collection(COLLECTIONS.COLLECTION_ROOMS).doc(roomId).get()
        if (!room || !room.data) {
          await transaction.rollback()
          return { status: 'not-found', room: null }
        }
        const r = room.data
        if (r.memberOpenids.includes(openid)) {
          await transaction.rollback() // 幂等：只读，无需提交
          return { status: 'already-member', room: r }
        }
        if (r.status !== 'active') {
          await transaction.rollback()
          return { status: 'ended', room: r }
        }
        if (r.memberOpenids.length >= MAX_MEMBERS) {
          await transaction.rollback()
          return { status: 'full', room: r }
        }
        const updated = {
          ...r,
          memberOpenids: r.memberOpenids.concat(openid),
          members: (r.members || []).concat([{ openid, joinedAt }]),
          updatedAt: joinedAt
        }
        // 只提交变更字段：真实云数据库禁止 update data 携带 _id（整文档回写会抛原生错误 -> 5001 服务异常）
        await transaction.collection(COLLECTIONS.COLLECTION_ROOMS).doc(roomId).update({
          data: {
            memberOpenids: updated.memberOpenids,
            members: updated.members,
            updatedAt: updated.updatedAt
          }
        })
        await transaction.commit()
        return { status: 'joined', room: updated }
      } catch (err) {
        await rollbackQuietly(transaction)
        throw err
      }
    },

    async listByMember(openid, skip, limit) {
      const res = await rooms
        .where({ memberOpenids: openid })
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(limit)
        .get()
      return res.data
    },

    /**
     * 事务内结束牌局
     * @returns {Promise<{status:string, room:object}>}
     */
    async endRoom(roomId, now) {
      const transaction = await db.startTransaction()
      try {
        const res = await transaction.collection(COLLECTIONS.COLLECTION_ROOMS).doc(roomId).get()
        if (!res || !res.data) {
          await transaction.rollback()
          return { status: 'not-found', room: null }
        }
        const r = res.data
        if (r.status === 'ended') {
          await transaction.rollback()
          return { status: 'already-ended', room: r }
        }
        const updated = { ...r, status: 'ended', endedAt: now, updatedAt: now }
        await transaction.collection(COLLECTIONS.COLLECTION_ROOMS).doc(roomId).update({
          data: { status: 'ended', endedAt: now, updatedAt: now }
        })
        await transaction.commit()
        return { status: 'ended', room: updated }
      } catch (err) {
        await rollbackQuietly(transaction)
        throw err
      }
    },

    /**
     * 删除房间文档
     * @returns {Promise<boolean>} 是否确有删除
     */
    async removeById(roomId) {
      const res = await rooms.doc(roomId).remove()
      const removed = (res && res.stats && res.stats.removed) || 0
      return removed > 0
    },

    /**
     * 批量清除某房间全部流水（分批循环直至删空）
     * @returns {Promise<number>} 删除总条数
     */
    async deleteByRoom(roomId) {
      let total = 0
      for (let i = 0; i < DELETE_ENTRIES_MAX_BATCHES; i++) {
        const res = await entries.where({ roomId }).remove()
        const removed = (res && res.stats && res.stats.removed) || 0
        total += removed
        if (removed === 0) return total
      }
      // 超过批次上限仍未删空（理论不可达），返回已删数量，剩余由重试补偿
      return total
    },

    // ── 流水扫描（供 detail 结算/最近流水）────────────────
    /**
     * 游标分页读取全部流水：createdAt 倒序，同毫秒 _id 倒序
     */
    async scanEntriesByRoom(roomId, cursor, batchSize) {
      let query = entries.where({ roomId })
      if (cursor) {
        // 取严格小于游标位置的记录：createdAt < cursor.createdAt
        //      或 (createdAt == cursor.createdAt 且 _id < cursor._id)
        query = query.and([
          _.or([
            { createdAt: _.lt(cursor.createdAt) },
            { createdAt: _.eq(cursor.createdAt), _id: _.lt(cursor._id) }
          ])
        ])
      }
      const res = await query
        .orderBy('createdAt', 'desc')
        .orderBy('_id', 'desc')
        .limit(batchSize)
        .get()
      const items = res.data
      const hasMore = items.length === batchSize
      const last = items[items.length - 1]
      return {
        items,
        hasMore,
        nextCursor: last ? { createdAt: last.createdAt, _id: last._id } : null
      }
    },

    /** 便捷别名（handler 通过 ctx.entryRepo.scanByRoom 调用） */
    scanByRoom(roomId, cursor, batchSize) {
      return this.scanEntriesByRoom(roomId, cursor, batchSize)
    }
  }
}

/** 回滚尽力而为：rollback 自身失败不得掩盖原始异常 */
async function rollbackQuietly(transaction) {
  try {
    await transaction.rollback()
  } catch (_) {
    // ignore
  }
}

function isInviteConflict(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /invite/i.test(msg) && /duplicate|唯一|unique|index/i.test(msg)
}

function isIdempotencyConflict(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /(createdByRequestId|ownerOpenid|idempotency)/i.test(msg) && /duplicate|唯一|unique|index/i.test(msg)
}

module.exports = { createRepositories }
