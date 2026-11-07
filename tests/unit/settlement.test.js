/**
 * 结算计算单元测试 — M5
 */

const { computeSettlement } = require('../../shared/settlement')
const { AppError, ErrorCodes } = require('../../shared/errors')

const members = [
  { openid: 'zhangsan', joinedAt: 1 },
  { openid: 'lisi', joinedAt: 2 },
  { openid: 'wangwu', joinedAt: 3 }
]

function expectInvalidEntry(fn) {
  try {
    fn()
    throw new Error('should have thrown')
  } catch (e) {
    expect(e).toBeInstanceOf(AppError)
    expect(e.code).toBe(ErrorCodes.INVALID_ENTRY)
  }
}

describe('computeSettlement', () => {
  test('M5-01 两笔流水：张三→李四 50 元、张三→王五 70 元', () => {
    const entries = [
      { fromOpenid: 'zhangsan', toOpenid: 'lisi', amountCents: 5000 },
      { fromOpenid: 'zhangsan', toOpenid: 'wangwu', amountCents: 7000 }
    ]
    const result = computeSettlement(entries, members)
    const byOpenid = Object.fromEntries(result.map(r => [r.openid, r.totalCents]))
    expect(byOpenid).toEqual({ zhangsan: -12000, lisi: 5000, wangwu: 7000 })
  })

  test('M5-02 无流水成员 -> 净额 0 且仍出现在结果中', () => {
    const entries = [{ fromOpenid: 'zhangsan', toOpenid: 'lisi', amountCents: 100 }]
    const result = computeSettlement(entries, members)
    const wangwu = result.find(r => r.openid === 'wangwu')
    expect(wangwu).toBeDefined()
    expect(wangwu.totalCents).toBe(0)
  })

  test('M5-03 所有成员净额相加精确为 0', () => {
    const entries = [
      { fromOpenid: 'zhangsan', toOpenid: 'lisi', amountCents: 300 },
      { fromOpenid: 'lisi', toOpenid: 'wangwu', amountCents: 800 },
      { fromOpenid: 'wangwu', toOpenid: 'zhangsan', amountCents: 150 }
    ]
    const result = computeSettlement(entries, members)
    const sum = result.reduce((s, r) => s + r.totalCents, 0)
    expect(sum).toBe(0)
  })

  test('M5-04 排序：净额降序，同额按 joinedAt 升序', () => {
    const tiedMembers = [
      { openid: 'late', joinedAt: 300 },
      { openid: 'early', joinedAt: 100 },
      { openid: 'loser', joinedAt: 200 }
    ]
    const entries = [{ fromOpenid: 'loser', toOpenid: 'early', amountCents: 50 }]
    // early +50，late 无流水为 0，loser -50 -> 降序：early, late, loser
    const result = computeSettlement(entries, tiedMembers)
    expect(result.map(r => r.openid)).toEqual(['early', 'late', 'loser'])
  })

  test('M5-04b 同额非零成员按 joinedAt 升序', () => {
    const tiedMembers = [
      { openid: 'b', joinedAt: 2 },
      { openid: 'a', joinedAt: 1 },
      { openid: 'loser1', joinedAt: 3 },
      { openid: 'loser2', joinedAt: 4 }
    ]
    const entries = [
      { fromOpenid: 'loser1', toOpenid: 'a', amountCents: 100 },
      { fromOpenid: 'loser2', toOpenid: 'b', amountCents: 100 }
    ]
    const result = computeSettlement(entries, tiedMembers)
    // a、b 均 +100，a joinedAt 小排前；loser1、loser2 均 -100
    expect(result.map(r => r.openid)).toEqual(['a', 'b', 'loser1', 'loser2'])
  })

  test('M5-05 无流水 -> 所有成员净额为 0', () => {
    const result = computeSettlement([], members)
    expect(result).toHaveLength(3)
    expect(result.every(r => r.totalCents === 0)).toBe(true)
  })

  test('M5-06 流水含非成员付款人 -> INVALID_ENTRY', () => {
    expectInvalidEntry(() =>
      computeSettlement([{ fromOpenid: 'ghost', toOpenid: 'lisi', amountCents: 100 }], members)
    )
  })

  test('M5-06b 流水含非成员收款人 -> INVALID_ENTRY', () => {
    expectInvalidEntry(() =>
      computeSettlement([{ fromOpenid: 'zhangsan', toOpenid: 'ghost', amountCents: 100 }], members)
    )
  })

  test('M5-07 金额 <= 0 -> INVALID_ENTRY', () => {
    expectInvalidEntry(() =>
      computeSettlement([{ fromOpenid: 'zhangsan', toOpenid: 'lisi', amountCents: 0 }], members)
    )
    expectInvalidEntry(() =>
      computeSettlement([{ fromOpenid: 'zhangsan', toOpenid: 'lisi', amountCents: -5 }], members)
    )
  })

  test('金额非整数 -> INVALID_ENTRY', () => {
    expectInvalidEntry(() =>
      computeSettlement([{ fromOpenid: 'zhangsan', toOpenid: 'lisi', amountCents: 1.5 }], members)
    )
  })

  test('付款人=收款人 -> INVALID_ENTRY', () => {
    expectInvalidEntry(() =>
      computeSettlement([{ fromOpenid: 'zhangsan', toOpenid: 'zhangsan', amountCents: 100 }], members)
    )
  })

  test('同一对玩家多笔流水累计', () => {
    const entries = [
      { fromOpenid: 'zhangsan', toOpenid: 'lisi', amountCents: 100 },
      { fromOpenid: 'zhangsan', toOpenid: 'lisi', amountCents: 250 },
      { fromOpenid: 'lisi', toOpenid: 'zhangsan', amountCents: 50 }
    ]
    const result = computeSettlement(entries, members)
    const byOpenid = Object.fromEntries(result.map(r => [r.openid, r.totalCents]))
    expect(byOpenid.zhangsan).toBe(-300)
    expect(byOpenid.lisi).toBe(300)
    expect(byOpenid.wangwu).toBe(0)
  })

  test('空成员列表 + 空流水 -> 空数组', () => {
    expect(computeSettlement([], [])).toEqual([])
  })

  test('空成员列表 + 有流水 -> INVALID_ENTRY', () => {
    expectInvalidEntry(() =>
      computeSettlement([{ fromOpenid: 'zhangsan', toOpenid: 'lisi', amountCents: 100 }], [])
    )
  })

  test('结果项包含 openid、totalCents、joinedAt', () => {
    const result = computeSettlement([], members)
    for (const item of result) {
      expect(item).toHaveProperty('openid')
      expect(item).toHaveProperty('totalCents')
      expect(item).toHaveProperty('joinedAt')
    }
    expect(result.find(r => r.openid === 'lisi').joinedAt).toBe(2)
  })
})
