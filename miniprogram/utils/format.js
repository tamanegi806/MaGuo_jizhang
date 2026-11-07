/**
 * 展示格式化工具函数
 */

/**
 * 格式化时间差（如"2分钟前"）
 * @param {number|string|Date} time
 * @returns {string}
 */
function timeAgo(time) {
  const now = Date.now()
  const t = typeof time === 'string' ? new Date(time).getTime() : Number(time)
  const diff = now - t
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  if (diff < 2592000000) return `${Math.floor(diff / 86400000)}天前`
  return new Date(t).toLocaleDateString('zh-CN')
}

/**
 * 格式化完整时间
 * @param {string|Date} date
 * @returns {string}
 */
function formatDateTime(date) {
  const d = new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${h}:${min}`
}

/**
 * 格式化金额（从分转元展示）
 * @param {number} cents
 * @param {object} [options]
 * @param {'always'|'negative'|'none'} [options.sign='negative']
 * @param {boolean} [options.currency=false]
 * @returns {string}
 */
function displayMoney(cents, options = {}) {
  const { sign = 'negative', currency = false } = options
  const abs = Math.abs(cents)
  const yuan = (abs / 100).toFixed(2)

  let prefix = ''
  if (cents < 0 && sign === 'negative') prefix = '-'
  else if (cents > 0 && sign === 'always') prefix = '+'
  if (currency) prefix += '¥'

  return prefix + yuan
}

module.exports = { timeAgo, formatDateTime, displayMoney }
