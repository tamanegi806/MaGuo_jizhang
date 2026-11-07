/**
 * 金额处理单元测试 — M1
 */

const { parseYuanToCents, formatCents, sumCents } = require('../../shared/money')
const { AppError } = require('../../shared/errors')
const { MAX_AMOUNT_CENTS } = require('../../shared/constants')

describe('parseYuanToCents', () => {
  test("M1-01 '50' -> 5000", () => {
    expect(parseYuanToCents('50')).toBe(5000)
  })
  test("M1-02 '50.5' -> 5050", () => {
    expect(parseYuanToCents('50.5')).toBe(5050)
  })
  test("M1-03 '50.05' -> 5005", () => {
    expect(parseYuanToCents('50.05')).toBe(5005)
  })
  test("M1-04 '0.01' -> 1", () => {
    expect(parseYuanToCents('0.01')).toBe(1)
  })
  test("M1-05 ' 30.00 ' -> 3000", () => {
    expect(parseYuanToCents(' 30.00 ')).toBe(3000)
  })
  test("M1-06 '1.234' -> INVALID_AMOUNT", () => {
    expect(() => parseYuanToCents('1.234')).toThrow(AppError)
  })
  test("M1-07 'abc' -> INVALID_AMOUNT", () => {
    expect(() => parseYuanToCents('abc')).toThrow(AppError)
  })
  test("'' -> INVALID_AMOUNT", () => {
    expect(() => parseYuanToCents('')).toThrow(AppError)
  })
  test("'--1' -> INVALID_AMOUNT", () => {
    expect(() => parseYuanToCents('--1')).toThrow(AppError)
  })
  test("M1-08 '1000000.01' -> INVALID_AMOUNT", () => {
    expect(() => parseYuanToCents('1000000.01')).toThrow(AppError)
  })
  test("符号保留：'-50' -> -5000", () => {
    expect(parseYuanToCents('-50')).toBe(-5000)
  })
  test("符号保留：'-0.01' -> -1", () => {
    expect(parseYuanToCents('-0.01')).toBe(-1)
  })
  test("符号保留：'+50.5' -> 5050", () => {
    expect(parseYuanToCents('+50.5')).toBe(5050)
  })
  test("'0' -> 0（非负归一化）", () => {
    expect(parseYuanToCents('0')).toBe(0)
    expect(Object.is(parseYuanToCents('-0'), 0)).toBe(true)
  })
  test("负数超上限：'-1000000.01' -> INVALID_AMOUNT", () => {
    expect(() => parseYuanToCents('-1000000.01')).toThrow(AppError)
  })
  test('等于 MAX_AMOUNT_CENTS 通过', () => {
    expect(parseYuanToCents('1000000')).toBe(MAX_AMOUNT_CENTS)
  })
})

describe('formatCents', () => {
  test("M1-09 5050, {currency:'none'} -> '¥50.50'", () => {
    expect(formatCents(5050, { currency: true, sign: 'none' })).toBe('¥50.50')
  })
  test("M1-10 -1 -> '-¥0.01'", () => {
    expect(formatCents(-1, { currency: true })).toBe('-¥0.01')
  })
  test("M1-11 0 -> '¥0.00'", () => {
    expect(formatCents(0, { currency: true })).toBe('¥0.00')
  })
  test('+1 with sign=always -> +¥0.01', () => {
    expect(formatCents(1, { currency: true, sign: 'always' })).toBe('+¥0.01')
  })
  test('负数 sign=none', () => {
    expect(formatCents(-100, { currency: true, sign: 'none' })).toBe('¥1.00')
  })
})

describe('sumCents', () => {
  test("M1-12 [100, -40, -60] -> 0", () => {
    expect(sumCents([100, -40, -60])).toBe(0)
  })
  test("M1-13 '0.1','0.2' 分别转分后求和为 30", () => {
    const a = parseYuanToCents('0.1')
    const b = parseYuanToCents('0.2')
    expect(sumCents([a, b])).toBe(30)
  })
  test('空数组 -> 0', () => {
    expect(sumCents([])).toBe(0)
  })
  test('非数组抛错', () => {
    expect(() => sumCents('not array')).toThrow(AppError)
  })
  test('含非整数抛错', () => {
    expect(() => sumCents([1, 2.5])).toThrow(AppError)
  })
})
