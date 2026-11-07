/**
 * 日期展示格式化（仅 UI 展示用，不做时区处理）
 */

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

/**
 * 毫秒时间戳 -> 'YYYY-MM-DD HH:mm'；无效返回 ''
 * @param {number} ts
 * @returns {string}
 */
function formatDateTime(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return ''
  const d = new Date(ts)
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  )
}

/**
 * 毫秒时间戳 -> 'HH:mm'；无效返回 ''
 * @param {number} ts
 * @returns {string}
 */
function formatClock(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return ''
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

module.exports = { formatDateTime, formatClock }
