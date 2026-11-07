/**
 * invite 云函数数据仓储 — 只需房间读取
 */

const COLLECTIONS = (() => {
  try {
    return require('../../shared/constants')
  } catch (_) {
    return require('./shared/constants')
  }
})()

function createRepositories(db) {
  const rooms = db.collection(COLLECTIONS.COLLECTION_ROOMS)

  return {
    async findById(roomId) {
      const res = await rooms.doc(roomId).get().catch(() => null)
      return res && res.data ? res.data : null
    }
  }
}

module.exports = { createRepositories }
