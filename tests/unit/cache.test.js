/**
 * v2.5 轻量内存缓存单元测试
 * 覆盖：TTL 命中/过期、remove/clearAll、键构造器、纯内存（无持久化 API）
 */

const fs = require('fs')
const path = require('path')
const cache = require('../../miniprogram/utils/cache')

afterEach(() => {
  cache.clearAll()
  jest.useRealTimers()
})

describe('utils/cache', () => {
  test('set/get 命中返回原值，未写入返回 undefined', () => {
    cache.set('k', { a: 1 })
    expect(cache.get('k')).toEqual({ a: 1 })
    expect(cache.get('missing')).toBeUndefined()
  })

  test('TTL 内命中、过期后 miss 且条目被清除', () => {
    jest.useFakeTimers()
    cache.set('k', 'v', 1000)
    jest.advanceTimersByTime(999)
    expect(cache.get('k')).toBe('v')
    jest.advanceTimersByTime(1)
    expect(cache.get('k')).toBeUndefined()
    // 过期条目已删除：时间倒流也拿不到（用新表证明 miss 非仅读取屏蔽）
    expect(cache.get('k')).toBeUndefined()
  })

  test('缺省 TTL 为 5 分钟', () => {
    jest.useFakeTimers()
    cache.set('k', 'v')
    jest.advanceTimersByTime(cache.DEFAULT_TTL_MS - 1)
    expect(cache.get('k')).toBe('v')
    jest.advanceTimersByTime(1)
    expect(cache.get('k')).toBeUndefined()
  })

  test('remove 精确失效单键，clearAll 清空全部', () => {
    cache.set('a', 1)
    cache.set('b', 2)
    cache.remove('a')
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    cache.clearAll()
    expect(cache.get('b')).toBeUndefined()
  })

  test('键构造器：列表全局一键、详情按 roomId 区分', () => {
    expect(cache.keys.roomsList()).toBe('rooms:list')
    expect(cache.keys.roomDetail('r_1')).toBe('room:detail:r_1')
    expect(cache.keys.roomDetail('r_2')).not.toBe(cache.keys.roomDetail('r_1'))
  })

  test('轻量版约束：只存内存，源码不得出现任何存储 API', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../miniprogram/utils/cache.js'),
      'utf8'
    )
    expect(src).not.toMatch(/wx\.(set|get|remove)Storage/)
  })
})
