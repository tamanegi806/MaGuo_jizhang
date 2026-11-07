/**
 * 生成 clientRequestId（幂等键）
 * 格式: prefix_ timestamp_random
 * @param {string} [prefix='req']
 * @returns {string}
 */
function genRequestId(prefix) {
  prefix = prefix || 'req'
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${ts}_${rand}`
}

/**
 * 生成 UUID v4（RFC 4122）
 * 小程序环境无 crypto 模块，使用 Math.random 实现；
 * 作为链路追踪 / 幂等键用途，碰撞概率可忽略。
 * @returns {string}
 */
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

module.exports = { genRequestId, uuidv4 }
