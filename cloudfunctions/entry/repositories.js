/**
 * entry 云函数数据仓储 — 云数据库真实实现（含事务）
 * 契约与 tests/helpers/fake-repos.js 的 FakeEntryRepo 一致
 */

const COLLECTIONS = (() => {
  try {
    return require('../../shared/constants')
  } catch (_) {
    return require('./shared/constants')
  }
})()

/**
 * @param {object} db - cloud.database()
 * @param {object} _ - db.command
 */
function createRepositories(db, _) {
  const rooms = db.collection(COLLECTIONS.COLLECTION_ROOMS)
  const entries = db.collection(COLLECTIONS.COLLECTION_ENTRIES)
  const users = db.collection(COLLECTIONS.COLLECTION_USERS)

  return {
    // ── 房间读 ──────────────────────────────
    async findById(roomId) {
      const res = await rooms.doc(roomId).get().catch(() => null)
      return res && res.data ? res.data : null
    },

    // ── 用户资料 ────────────────────────────
    async findManyByOpenids(openids) {
      if (!openids.length) return []
      const res = await users.where({ openid: _.in(openids) }).get()
      return res.data
    },

    // ── 流水幂等查询 ────────────────────────
    async findByIdempotency(roomId, clientRequestId) {
      const res = await entries.where({ roomId, clientRequestId }).limit(1).get()
      return res.data[0] || null
    },

    /**
     * 事务：按 _id 读房间 -> 校验回调 -> 插入一条流水
     * validateInRoom 抛 AppError 则回滚并传播（只读取一个房间文档、插入一条流水）
     * @param {{roomId:string, clientRequestId:string, createdBy:string, createdAt:number}} meta
     * @param {(room:object) => object} validateInRoom
     * @returns {Promise<{status:'created'|'duplicate'|'not-found', entry?:object}>}
     */
    async createAtomically(meta, validateInRoom) {
      const transaction = await db.startTransaction()
      try {
        const res = await transaction
          .collection(COLLECTIONS.COLLECTION_ROOMS)
          .doc(meta.roomId)
          .get()
          .catch(() => null)
        if (!res || !res.data) {
          await transaction.rollback()
          return { status: 'not-found' }
        }

        const doc = validateInRoom(res.data) // 校验失败抛 AppError -> catch -> rollback

        const data = {
          ...doc,
          roomId: meta.roomId,
          clientRequestId: meta.clientRequestId,
          createdBy: meta.createdBy,
          createdAt: meta.createdAt
        }
        const added = await transaction.collection(COLLECTIONS.COLLECTION_ENTRIES).add({ data })
        await transaction.commit()
        return { status: 'created', entry: { ...data, _id: added._id } }
      } catch (err) {
        try {
          await transaction.rollback()
        } catch (_) {
          // 回滚失败不掩盖原始异常
        }
        // 唯一索引（roomId + clientRequestId）冲突 -> 幂等重查路径
        if (isUniqueConflict(err)) {
          return { status: 'duplicate' }
        }
        if (err && err.code) {
          throw err // AppError 原样传播
        }
        throw err
      }
    },

    /**
     * 分页读取：createdAt 倒序、同毫秒 _id 倒序
     */
    async listByRoom(roomId, skip, limit) {
      const res = await entries
        .where({ roomId })
        .orderBy('createdAt', 'desc')
        .orderBy('_id', 'desc')
        .skip(skip)
        .limit(limit)
        .get()
      return res.data
    }
  }
}

function isUniqueConflict(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /clientRequestId|duplicate|唯一|unique|index/i.test(msg)
}

module.exports = { createRepositories }
