/**
 * 邀请码生成、规范化、校验
 */

const { INVITE_CODE_LENGTH, INVITE_CODE_ALPHABET } = require('./constants')

// 预构建字符集数组用于索引查找
const _alphabetArr = INVITE_CODE_ALPHABET.split('')
const _alphabetSize = _alphabetArr.length

// 预构建字符集 Set 用于 O(1) 查找
const _charSet = new Set(_alphabetArr)

/**
 * 生成随机邀请码
 * @param {(n?: number) => number} rng - 返回 [0,1) 的随机函数（无参）或 (min,max)=>int（双参）。测试时注入固定序列。
 * @param {number} [length] - 码长，默认 INVITE_CODE_LENGTH（v2.0 起 4）
 * @returns {string} 纯数字码（字符集 '0123456789'，v2.0 起口头传码友好；空间 10^4，
 *   结束牌局释放码位见 room 仓储 endRoom 的归档前缀，码池按「进行中牌局数」计而非累计建局数）
 */
function generateCode(rng, length) {
  if (typeof rng !== 'function') {
    throw new TypeError('rng must be a function')
  }
  length = length || INVITE_CODE_LENGTH

  // 判断是 (min,max) => int 还是 () => float
  // 通过检测函数签名长度：crypto.randomInt 有 length=2，Math.random 有 length=0
  const supportsRange = rng.length >= 2

  let code = ''
  for (let i = 0; i < length; i++) {
    let idx
    if (supportsRange) {
      idx = rng(0, _alphabetSize)
    } else {
      idx = Math.floor(rng() * _alphabetSize)
    }
    // 取模保证不越界
    idx = ((idx % _alphabetSize) + _alphabetSize) % _alphabetSize
    code += _alphabetArr[idx]
  }
  return code
}

/**
 * 规范化邀请码 — trim 后转大写
 * @param {*} input
 * @returns {string}
 */
function normalizeCode(input) {
  if (input == null) return ''
  return String(input).trim().toUpperCase()
}

/**
 * 校验邀请码格式
 * @param {*} code
 * @returns {boolean}
 */
function isValidCodeFormat(code) {
  if (code == null || typeof code !== 'string') return false
  if (code.length !== INVITE_CODE_LENGTH) return false
  for (let i = 0; i < code.length; i++) {
    if (!_charSet.has(code[i])) return false
  }
  return true
}

module.exports = { generateCode, normalizeCode, isValidCodeFormat, INVITE_CODE_LENGTH, INVITE_CODE_ALPHABET }
