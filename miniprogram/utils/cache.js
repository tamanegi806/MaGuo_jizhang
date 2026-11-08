/**
 * v2.5 轻量内存缓存（详细设计 6.4.1）
 * - 只存内存：同一次使用内秒开首屏，小程序被杀重开后为空，不写任何本地持久化存储；
 * - 读取即判过期（TTL），过期条目顺手删除；
 * - 写时失效（remove）：create/join/end/delete/记一笔成功后清掉对应键，避免下次进入渲染脏数据。
 */

/** 默认存活期：5 分钟（SWR 模式后台总会重新校准，TTL 只决定「还值不值得先渲染」） */
const DEFAULT_TTL_MS = 5 * 60 * 1000

/** key -> { value, expiresAt } */
const store = new Map()

/**
 * 读取缓存
 * @param {string} key
 * @returns {*} 命中且未过期返回存入值；否则 undefined
 */
function get(key) {
  const hit = store.get(key)
  if (!hit) return undefined
  if (Date.now() >= hit.expiresAt) {
    store.delete(key)
    return undefined
  }
  return hit.value
}

/**
 * 写入缓存
 * @param {string} key
 * @param {*} value
 * @param {number} [ttlMs] 存活毫秒数，默认 DEFAULT_TTL_MS
 */
function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

/**
 * 失效某个键（写操作成功后调用）
 * @param {string} key
 */
function remove(key) {
  store.delete(key)
}

/** 清空全部缓存 —— 测试接缝，用例间隔离模块级状态 */
function clearAll() {
  store.clear()
}

/** 集中定义键，防止拼写漂移 */
const keys = {
  /** 首页第 0 页牌局列表 */
  roomsList: () => 'rooms:list',
  /** 牌局详情（含 recentEntries / settlement） */
  roomDetail: (roomId) => `room:detail:${roomId}`
}

module.exports = { get, set, remove, clearAll, keys, DEFAULT_TTL_MS }
