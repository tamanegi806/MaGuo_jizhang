/* !AUTO-GENERATED: 由 scripts/sync-shared.js 从 shared/ 同步生成，请勿直接编辑本文件 */
/**
 * 金额处理 — 元 ↔ 分转换、格式化、求和
 */

const { MAX_AMOUNT_CENTS } = require('./constants')
const { AppError } = require('./errors')

/**
 * 解析元字符串为整数分
 * @param {string} input
 * @param {object} [options]
 * @returns {number} 整数分
 */
function parseYuanToCents(input, options = {}) {
  if (typeof input !== 'string') {
    throw new AppError(3003, 'INVALID_AMOUNT', 'input must be a string')
  }
  const trimmed = input.trim()
  if (trimmed === '') {
    throw new AppError(3003, 'INVALID_AMOUNT', 'empty input')
  }

  // 匹配格式: 可选符号 + 整数部分 + 可选小数部分(1~2位)
  const match = trimmed.match(/^[+-]?(\d+)(\.(\d{1,2}))?$/)
  if (!match) {
    throw new AppError(3003, 'INVALID_AMOUNT', `invalid format: ${input}`)
  }

  const intPart = match[1]
  let decPart = (match[3] || '').padEnd(2, '0')

  // 拼接完整分值；符号保留（金额是否允许为负由上层领域规则决定）
  const centsStr = intPart + decPart
  let cents = parseInt(centsStr, 10)
  if (match[0].trim().charAt(0) === '-') {
    cents = -cents
  }
  if (cents === 0) {
    cents = 0 // 归一化 -0
  }

  if (!Number.isSafeInteger(cents)) {
    throw new AppError(3003, 'INVALID_AMOUNT', 'value exceeds safe integer range')
  }
  if (Math.abs(cents) > MAX_AMOUNT_CENTS) {
    throw new AppError(3003, 'INVALID_AMOUNT', `exceeds maximum: ${MAX_AMOUNT_CENTS}`)
  }

  return cents
}

/**
 * 格式化分为元展示字符串
 * @param {number} cents
 * @param {object} [options]
 * @param {'always'|'negative'|'none'} [options.sign='negative']
 * @param {boolean} [options.currency=false]
 * @returns {string}
 */
function formatCents(cents, options = {}) {
  if (!Number.isInteger(cents)) {
    throw new AppError(4001, 'INVALID_PARAM', 'cents must be an integer')
  }

  const abs = Math.abs(cents)
  const yuan = (abs / 100).toFixed(2)

  let prefix = ''
  if (cents < 0 && options.sign !== 'none') {
    prefix = '-'
  } else if (cents > 0 && options.sign === 'always') {
    prefix = '+'
  }
  if (options.currency) {
    prefix += '¥'
  }

  return prefix + yuan
}

/**
 * 对整数分数组求和
 * @param {number[]} centsList
 * @returns {number}
 */
function sumCents(centsList) {
  if (!Array.isArray(centsList)) {
    throw new AppError(4001, 'INVALID_PARAM', 'must be an array')
  }
  for (const v of centsList) {
    if (!Number.isInteger(v)) {
      throw new AppError(4001, 'INVALID_PARAM', 'all values must be integers')
    }
  }
  return centsList.reduce((sum, v) => sum + v, 0)
}

module.exports = { parseYuanToCents, formatCents, sumCents }
