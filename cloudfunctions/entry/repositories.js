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
     * validateInRoom 抛 AppError 则回滚并传播（读一个房间快照、插一条流水）
     *
     * v2.6 修正：**事务内不得写 rooms 文档**。云开发事务「读为快照、写才加事务锁」，
     * 若在此处顺带 update 房间，同牌局两人同时记账会命中写冲突（DATABASE_TRANSACTION_CONFLICT），
     * 而 startTransaction 不会自动重试 -> 整笔事务回滚 -> 用户看到 5001「服务异常」且流水丢失。
     * 活跃时间改由 commit 之后 `bumpActivity` 单文档更新推进（非事务更新遇锁只阻塞、不失败）。
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
     * v2.6：推进房间活跃时间（重置闲置自动结束倒计时）
     * 非事务单文档更新：并发时由云数据库阻塞到对方事务锁释放，不会失败；
     * 与流水插入不同事务，故可能「流水已落、活跃时间未推进」（少一次重置），
     * 属可接受降级——下一笔成功记账仍会推进，不影响账目正确性。
     * 同时刷新 `updatedAt`：使定时器 `idx_status_updated` 的扫描顺序与闲置判据同向，
     * 也让历史房间的回退口径 `max(createdAt, updatedAt)` 对记账同样灵敏。
     * 失败原样上抛，由调用方（handlers.add）决定是否容忍。
     * @param {string} roomId
     * @param {number} at 活跃基准（该笔流水 createdAt）
     */
    async bumpActivity(roomId, at) {
      return rooms.doc(roomId).update({ data: { lastActivityAt: at, updatedAt: at } })
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
