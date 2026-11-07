/**
 * auth 云函数数据仓储 — 云数据库真实实现
 * 测试时不经过本文件，直接向 handler 注入内存仓储
 */

const { COLLECTION_USERS } = (() => {
  try {
    return require('./shared/constants')
  } catch (_) {
    return require('../../shared/constants')
  }
})()

/**
 * @param {object} db - cloud.database()
 */
function createRepositories(db) {
  const users = db.collection(COLLECTION_USERS)

  return {
    /**
     * @param {string} openid
     * @returns {Promise<object|null>}
     */
    async findByOpenid(openid) {
      const res = await users.where({ openid }).limit(1).get()
      return res.data[0] || null
    },

    /**
     * 插入新用户；openid 唯一索引冲突时抛错，由 login 捕获后重查
     * @param {object} user
     * @returns {Promise<object>}
     */
    async insert(user) {
      await users.add({ data: user })
      return user
    },

    /**
     * 更新指定字段
     * @param {string} openid
     * @param {object} fields
     */
    async update(openid, fields) {
      await users.where({ openid }).update({ data: fields })
      return fields
    }
  }
}

module.exports = { createRepositories }
