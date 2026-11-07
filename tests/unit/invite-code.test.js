/**
 * 邀请码单元测试 — M2
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
  test('M2-01 固定 rng 序列 -> 6位、字符均在字符集内', () => {
    const rng = makeFixedRng([1, 5, 10, 20, 30, 40])
    const code = generateCode(rng)
    expect(code.length).toBe(INVITE_CODE_LENGTH)
    for (const ch of code) {
      expect(INVITE_CODE_ALPHABET.includes(ch)).toBe(true)
    }
  })

  test('M2-02 生成 1000 次 -> 不含 0 O 1 I', () => {
    // 使用 Math.random 做统计测试
    const forbidden = new Set('0O1I')
    for (let i = 0; i < 1000; i++) {
      const code = generateCode(Math.random)
      for (const ch of code) {
        expect(forbidden.has(ch)).toBe(false)
      }
    }
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
  test("M2-03 ' a7k2m9 ' -> 'A7K2M9'", () => {
    expect(normalizeCode(' a7k2m9 ')).toBe('A7K2M9')
  })
  test("M2-05 'abc234' -> 'ABC234'", () => {
    expect(normalizeCode('abc234')).toBe('ABC234')
  })
  test('null -> ""', () => {
    expect(normalizeCode(null)).toBe('')
  })
  test('数字 123 -> "123"', () => {
    expect(normalizeCode(123)).toBe('123')
  })
})

describe('isValidCodeFormat', () => {
  test("M2-04 'ABC234' -> true", () => {
    expect(isValidCodeFormat('ABC234')).toBe(true)
  })
  test("M2-05 'abc234' 规范化后合法", () => {
    const normalized = normalizeCode('abc234')
    expect(isValidCodeFormat(normalized)).toBe(true)
  })
  test("M2-06 'ABC23' -> false", () => {
    expect(isValidCodeFormat('ABC23')).toBe(false)
  })
  test("M2-06 'ABC2345' -> false", () => {
    expect(isValidCodeFormat('ABC2345')).toBe(false)
  })
  test("M2-07 'ABC10O' -> false", () => {
    expect(isValidCodeFormat('ABC10O')).toBe(false)
  })
  test("M2-08 null -> false", () => {
    expect(isValidCodeFormat(null)).toBe(false)
  })
  test("M2-08 123 (number) -> false", () => {
    expect(isValidCodeFormat(123)).toBe(false)
  })
  test("空串 -> false", () => {
    expect(isValidCodeFormat('')).toBe(false)
  })
})
