/**
 * 日志记录工具 — 云函数公共层
 * 自动生成，请勿修改（由 sync-shared.js 管理）
 */

const crypto = require('crypto')

/**
 * 生成唯一 requestId
 * @returns {string}
 */
function generateRequestId() {
  return crypto.randomBytes(8).toString('hex')
}

/**
 * 脱敏 openid（隐藏中间部分）
 * @param {string} openid
 * @returns {string}
 */
function maskOpenid(openid) {
  if (!openid || openid.length < 12) return openid || ''
  return openid.slice(0, 6) + '****' + openid.slice(-4)
}

/**
 * 记录一次操作日志
 * @param {object} options
 * @param {string} options.action - 动作名
 * @param {string} [options.requestId] - requestId
 * @param {string} [options.openid] - 用户 openid
 * @param {object} [options.meta] - 附加元数据
 * @param {number} [options.duration] - 耗时(ms)
 */
function log({ action, requestId, openid, meta = {}, duration }) {
  const entry = {
    timestamp: new Date().toISOString(),
    requestId: requestId || generateRequestId(),
    action,
    openid: openid ? maskOpenid(openid) : null,
    ...meta
  }
  if (duration !== undefined) {
    entry.duration = duration
  }
  console.log('[cloud]', JSON.stringify(entry))
}

module.exports = { generateRequestId, maskOpenid, log }
