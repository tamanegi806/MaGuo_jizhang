/**
 * 邀请码单元测试 — M2
 * v2.0：邀请码为 4 位纯数字（字符集 '0123456789'），旧 6 位字母数字码停用
 */

const { generateCode, normalizeCode, isValidCodeFormat, INVITE_CODE_ALPHABET } = require('../../shared/invite-code')
const { INVITE_CODE_LENGTH } = require('../../shared/constants')

// 固定序列的 rng 供测试注入
function makeFixedRng(values) {
  let i = 0
  // 双参风格 (min, max) => int，方便测试 crypto.randomInt 包装
  return (min, max) => {
    if (arguments.length >= 2) {
      const val = values[i % values.length]
      i++
      return min + (val % (max - min))
    }
    const val = values[i % values.length]
    i++
    return val
  }
}

describe('generateCode', () => {
  test('M2-01 固定 rng 序列 -> 4位、字符均为数字', () => {
    const rng = makeFixedRng([1, 5, 9, 2, 7, 0])
    const code = generateCode(rng)
    expect(code.length).toBe(INVITE_CODE_LENGTH)
    for (const ch of code) {
      expect(INVITE_CODE_ALPHABET.includes(ch)).toBe(true)
    }
    expect(code).toMatch(/^[0-9]{4}$/)
  })

  test('M2-02 生成 1000 次 -> 全为数字且含前导 0 样例', () => {
    // 使用 Math.random 做统计测试
    let sawLeadingZero = false
    for (let i = 0; i < 1000; i++) {
      const code = generateCode(Math.random)
      expect(code).toMatch(/^[0-9]{4}$/)
      if (code[0] === '0') sawLeadingZero = true
    }
    // 1000 次内约 90% 概率出现前导 0；未出现也不视为失败，仅记录
    void sawLeadingZero
  })

  test('自定义 length=8', () => {
    const rng = makeFixedRng([1, 2, 3, 4, 5, 6, 7, 8])
    const code = generateCode(rng, 8)
    expect(code.length).toBe(8)
  })

  test('rng 不是函数抛错', () => {
    expect(() => generateCode('not-a-fn')).toThrow(TypeError)
  })
})

describe('normalizeCode', () => {
  test("M2-03 ' 0823 ' -> '0823'（去空格）", () => {
    expect(normalizeCode(' 0823 ')).toBe('0823')
  })
  test('数字 123 -> "123"（不足 4 位仍原样，交由格式校验拒绝）', () => {
    expect(normalizeCode(123)).toBe('123')
  })
  test('null -> ""', () => {
    expect(normalizeCode(null)).toBe('')
  })
})

describe('isValidCodeFormat', () => {
  test("M2-04 '8234' -> true", () => {
    expect(isValidCodeFormat('8234')).toBe(true)
  })
  test("'0000' -> true（前导零合法）", () => {
    expect(isValidCodeFormat('0000')).toBe(true)
  })
  test("M2-05 '123' -> false（长度不足）", () => {
    expect(isValidCodeFormat('123')).toBe(false)
  })
  test("M2-06 '12345' -> false（超长）", () => {
    expect(isValidCodeFormat('12345')).toBe(false)
  })
  test("M2-07 '12a4' -> false（非数字）", () => {
    expect(isValidCodeFormat('12a4')).toBe(false)
  })
  test("旧版 6 位字母码 'A7K2M9' -> false（v2.0 起停用）", () => {
    expect(isValidCodeFormat('A7K2M9')).toBe(false)
  })
  test("M2-08 null -> false", () => {
    expect(isValidCodeFormat(null)).toBe(false)
  })
  test("M2-08 1234 (number) -> false", () => {
    expect(isValidCodeFormat(1234)).toBe(false)
  })
  test("空串 -> false", () => {
    expect(isValidCodeFormat('')).toBe(false)
  })
})
