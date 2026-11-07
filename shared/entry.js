/**
 * 流水领域校验与归一化
 */

const { AppError, ErrorCodes } = require('./errors')
const { MAX_AMOUNT_CENTS } = require('./constants')

/**
 * 校验流水输入（不抛异常，返回结果对象）
 * @param {object} input
 * @param {string} input.fromOpenid
 * @param {string} input.toOpenid
 * @param {number} input.amountCents
 * @param {object} ctx - { memberOpenids: string[] }
 * @returns {{ ok: boolean, errors?: string[], data?: null }}
 */
function validateEntry(input, ctx) {
  const errors = []
  const from = input.fromOpenid
  const to = input.toOpenid
  const amount = input.amountCents

  // 必填字段校验
  if (!from || typeof from !== 'string') {
    errors.push('INVALID_ENTRY')
  }
  if (!to || typeof to !== 'string') {
    errors.push('INVALID_ENTRY')
  }
  // 有付款人和收款人时检查同一性
  if (from && to && from === to) {
    errors.push('SAME_PAYER_PAYEE')
  }

  // 金额校验
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT_CENTS || !Number.isSafeInteger(amount)) {
    errors.push('INVALID_AMOUNT')
  }

  // 成员校验（只有必填项都合法时才检查；ctx 或 memberOpenids 缺失时跳过）
  if (!errors.includes('INVALID_ENTRY') && ctx && Array.isArray(ctx.memberOpenids)) {
    const invalidMember = !ctx.memberOpenids.includes(from) || !ctx.memberOpenids.includes(to)
    if (invalidMember) {
      errors.push('INVALID_MEMBER')
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true }
}

/**
 * 归一化流水数据
 * 先校验再丢弃多余字段
 * @param {object} input
 * @param {object} ctx
 * @returns {{fromOpenid:string,toOpenid:string,amountCents:number}}
 */
function normalizeEntry(input, ctx) {
  const validation = validateEntry(input, ctx)
  if (!validation.ok) {
    // 取第一个错误码抛出
    const name = validation.errors[0]
    throw new AppError(ErrorCodes[name] || ErrorCodes.INVALID_ENTRY, name)
  }

  return {
    fromOpenid: input.fromOpenid,
    toOpenid: input.toOpenid,
    amountCents: input.amountCents
  }
}

module.exports = { validateEntry, normalizeEntry }
