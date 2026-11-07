/**
 * 结算计算 — 根据流水累计每个成员的净额
 */

const { AppError, ErrorCodes } = require('./errors')
const { sumCents } = require('./money')

/**
 * 计算牌局结算
 * @param {Array<{fromOpenid:string,toOpenid:string,amountCents:number}>} entries
 * @param {Array<{openid:string,joinedAt?:number}>} members
 * @returns {Array<{openid:string,totalCents:number,joinedAt?:number}>}
 */
function computeSettlement(entries, members) {
  // 初始化所有成员的净额为 0
  const totals = {}
  const joinedAtMap = {}
  for (const m of members) {
    totals[m.openid] = 0
    if (m.joinedAt !== undefined) {
      joinedAtMap[m.openid] = m.joinedAt
    }
  }

  // 遍历流水累计
  for (const entry of entries) {
    const { fromOpenid, toOpenid, amountCents } = entry

    // 校验付款人/收款人是成员
    if (!(fromOpenid in totals)) {
      throw new AppError(ErrorCodes.INVALID_ENTRY, 'INVALID_ENTRY', `fromOpenid ${fromOpenid} not in members`)
    }
    if (!(toOpenid in totals)) {
      throw new AppError(ErrorCodes.INVALID_ENTRY, 'INVALID_ENTRY', `toOpenid ${toOpenid} not in members`)
    }
    // 付款人 = 收款人不允许
    if (fromOpenid === toOpenid) {
      throw new AppError(ErrorCodes.INVALID_ENTRY, 'INVALID_ENTRY', 'payer equals payee in entry')
    }
    // 金额必须为正整数
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new AppError(ErrorCodes.INVALID_ENTRY, 'INVALID_ENTRY', 'amount must be positive integer')
    }

    totals[fromOpenid] -= amountCents
    totals[toOpenid] += amountCents
  }

  // 断言全员净额之和为 0
  const allTotals = Object.values(totals)
  const totalSum = sumCents(allTotals)
  if (totalSum !== 0) {
    throw new AppError(ErrorCodes.INVALID_ENTRY, 'INVALID_ENTRY', `sum of nets is ${totalSum}, expected 0`)
  }

  // 构建结果数组并排序
  const result = allTotals.map((t, i) => {
    const openid = Object.keys(totals)[i]
    return {
      openid,
      totalCents: t,
      joinedAt: joinedAtMap[openid]
    }
  })

  // 排序：净额降序，同额按 joinedAt 升序
  result.sort((a, b) => {
    if (b.totalCents !== a.totalCents) return b.totalCents - a.totalCents
    if (a.joinedAt !== undefined && b.joinedAt !== undefined) {
      return a.joinedAt - b.joinedAt
    }
    return 0
  })

  return result
}

module.exports = { computeSettlement }
