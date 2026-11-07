/**
 * 流水领域校验单元测试 — M4
 */

const { validateEntry, normalizeEntry } = require('../../shared/entry')
const { AppError, ErrorCodes } = require('../../shared/errors')
const { MAX_AMOUNT_CENTS } = require('../../shared/constants')

const ctx = { memberOpenids: ['alice', 'bob', 'carol'] }

const valid = { fromOpenid: 'alice', toOpenid: 'bob', amountCents: 5000 }

describe('validateEntry', () => {
  test('M4-01 合法输入 -> ok:true', () => {
    expect(validateEntry(valid, ctx)).toEqual({ ok: true })
  })

  test('M4-02 付款人=收款人 -> SAME_PAYER_PAYEE', () => {
    const r = validateEntry({ ...valid, toOpenid: 'alice' }, ctx)
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('SAME_PAYER_PAYEE')
  })

  test('M4-03 付款人非成员 -> INVALID_MEMBER', () => {
    const r = validateEntry({ ...valid, fromOpenid: 'mallory' }, ctx)
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('INVALID_MEMBER')
  })

  test('M4-04 收款人非成员 -> INVALID_MEMBER', () => {
    const r = validateEntry({ ...valid, toOpenid: 'mallory' }, ctx)
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('INVALID_MEMBER')
  })

  test('双方均非成员 -> 只报一次 INVALID_MEMBER', () => {
    const r = validateEntry({ ...valid, fromOpenid: 'x', toOpenid: 'y' }, ctx)
    expect(r.errors).toEqual(['INVALID_MEMBER'])
  })

  test('M4-05 金额 0 -> INVALID_AMOUNT', () => {
    const r = validateEntry({ ...valid, amountCents: 0 }, ctx)
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('INVALID_AMOUNT')
  })

  test('M4-06 金额负数 -> INVALID_AMOUNT', () => {
    const r = validateEntry({ ...valid, amountCents: -100 }, ctx)
    expect(r.errors).toContain('INVALID_AMOUNT')
  })

  test('M4-07 金额非整数 -> INVALID_AMOUNT', () => {
    const r = validateEntry({ ...valid, amountCents: 50.5 }, ctx)
    expect(r.errors).toContain('INVALID_AMOUNT')
  })

  test('M4-08 金额超过上限 100000001 -> INVALID_AMOUNT', () => {
    const r = validateEntry({ ...valid, amountCents: MAX_AMOUNT_CENTS + 1 }, ctx)
    expect(r.errors).toContain('INVALID_AMOUNT')
  })

  test('金额恰好等于 MAX_AMOUNT_CENTS -> 通过', () => {
    expect(validateEntry({ ...valid, amountCents: MAX_AMOUNT_CENTS }, ctx)).toEqual({ ok: true })
  })

  test('金额为字符串 -> INVALID_AMOUNT', () => {
    const r = validateEntry({ ...valid, amountCents: '5000' }, ctx)
    expect(r.errors).toContain('INVALID_AMOUNT')
  })

  test('金额超出安全整数范围 -> INVALID_AMOUNT', () => {
    const r = validateEntry({ ...valid, amountCents: Number.MAX_SAFE_INTEGER + 10 }, ctx)
    expect(r.errors).toContain('INVALID_AMOUNT')
  })

  test('M4-09 缺少付款人 -> INVALID_ENTRY', () => {
    const { fromOpenid, ...rest } = valid
    const r = validateEntry(rest, ctx)
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('INVALID_ENTRY')
  })

  test('M4-09 缺少收款人 -> INVALID_ENTRY', () => {
    const { toOpenid, ...rest } = valid
    const r = validateEntry(rest, ctx)
    expect(r.errors).toContain('INVALID_ENTRY')
  })

  test('付款人为空字符串 -> INVALID_ENTRY', () => {
    const r = validateEntry({ ...valid, fromOpenid: '' }, ctx)
    expect(r.errors).toContain('INVALID_ENTRY')
  })

  test('字段同时非法 -> 多个错误码并存', () => {
    const r = validateEntry({ fromOpenid: '', toOpenid: '', amountCents: -1 }, ctx)
    expect(r.errors).toContain('INVALID_ENTRY')
    expect(r.errors).toContain('INVALID_AMOUNT')
  })

  test('空成员列表 -> INVALID_MEMBER', () => {
    const r = validateEntry(valid, { memberOpenids: [] })
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('INVALID_MEMBER')
  })

  test('ctx 缺失 -> 不崩溃，跳过成员校验', () => {
    expect(validateEntry(valid)).toEqual({ ok: true })
  })

  test('ctx 缺少 memberOpenids 字段 -> 跳过成员校验', () => {
    expect(validateEntry(valid, {})).toEqual({ ok: true })
  })

  test('不抛业务异常', () => {
    expect(() => validateEntry({}, null)).not.toThrow()
  })
})

describe('normalizeEntry', () => {
  test('M4-10 归一化后多余字段被丢弃', () => {
    const input = { ...valid, extra: 'x', clientRequestId: 'abc', note: 'handed cash' }
    expect(normalizeEntry(input, ctx)).toEqual({
      fromOpenid: 'alice',
      toOpenid: 'bob',
      amountCents: 5000
    })
  })

  test('合法输入返回三分字段结构', () => {
    const out = normalizeEntry(valid, ctx)
    expect(Object.keys(out).sort()).toEqual(['amountCents', 'fromOpenid', 'toOpenid'])
  })

  test('校验失败抛 AppError：SAME_PAYER_PAYEE', () => {
    try {
      normalizeEntry({ ...valid, toOpenid: 'alice' }, ctx)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AppError)
      expect(e.code).toBe(ErrorCodes.SAME_PAYER_PAYEE)
    }
  })

  test('校验失败抛 AppError：INVALID_AMOUNT', () => {
    expect(() => normalizeEntry({ ...valid, amountCents: 0 }, ctx)).toThrow(
      expect.objectContaining({ code: ErrorCodes.INVALID_AMOUNT })
    )
  })

  test('校验失败抛 AppError：INVALID_MEMBER', () => {
    expect(() => normalizeEntry({ ...valid, toOpenid: 'mallory' }, ctx)).toThrow(
      expect.objectContaining({ code: ErrorCodes.INVALID_MEMBER })
    )
  })

  test('校验失败抛 AppError：INVALID_ENTRY', () => {
    expect(() => normalizeEntry({ amountCents: 5000 }, ctx)).toThrow(
      expect.objectContaining({ code: ErrorCodes.INVALID_ENTRY })
    )
  })
})
