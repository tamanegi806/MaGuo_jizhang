/**
 * 云函数调用封装 — 前端唯一出云通道
 * 页面与服务不得直接调用 wx.cloud.callFunction，统一经此模块（详细设计 6.4、禁止事项第 7 条）
 * v2.5：在途去重 —— 同名同动作同参数的并发调用共享同一请求，落地即出表（详见 6.4.1）。
 */

const { uuidv4 } = require('../utils/uuid')

const NETWORK_ERROR_CODE = 'NETWORK_ERROR'
const NETWORK_ERROR_MESSAGE = '网络异常，请检查连接'

/** 在途请求表：去重键 -> 共享 Promise */
const inflight = new Map()
let dedupSeq = 0

/** 对象键排序后序列化，保证 {a,b} 与 {b,a} 视为同一参数 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const out = {}
    Object.keys(value)
      .sort()
      .forEach((k) => {
        out[k] = canonical(value[k])
      })
    return out
  }
  return value
}

/**
 * 去重键：云函数名 + 动作 + 规范化参数。
 * requestId / timeout 属传输元数据，不参与判同；
 * 参数不可序列化时退化为每次唯一键（等同不去重）。
 */
function dedupKey(name, action, payload) {
  try {
    return `${name}|${action}|${JSON.stringify(canonical(payload === undefined ? {} : payload))}`
  } catch (e) {
    return `${name}|${action}|#nodedup|${++dedupSeq}`
  }
}

/**
 * 业务/网络统一错误对象
 * code：数字为服务端业务错误码；'NETWORK_ERROR' 为网络层异常
 */
class ApiError extends Error {
  /**
   * @param {number|string} code
   * @param {string} [message]
   * @param {*} [data] - 失败响应携带的附加数据（原样保留）
   */
  constructor(code, message, data) {
    super(message || '请求失败')
    this.name = 'ApiError'
    this.code = code
    this.data = data === undefined ? null : data
    Object.setPrototypeOf(this, ApiError.prototype)
  }
}

let requestIdFactory = uuidv4

/**
 * 测试接缝：注入固定 requestId 生成器（传 null 恢复默认）
 * @param {(() => string)|null} fn
 */
function setRequestIdFactory(fn) {
  requestIdFactory = typeof fn === 'function' ? fn : uuidv4
}

/**
 * 调用云函数并解包统一响应（含在途去重）
 * @param {string} name 云函数名
 * @param {string} action 动作
 * @param {object} [payload] 业务参数
 * @param {{requestId?: string, timeout?: number}} [options]
 * @returns {Promise<any>} 成功时的 data
 * @throws {ApiError}
 */
function call(name, action, payload, options) {
  const key = dedupKey(name, action, payload)
  const existing = inflight.get(key)
  if (existing) return existing // 并发同键：复用同一在途请求

  const p = perform(name, action, payload, options).finally(() => {
    inflight.delete(key) // 落地即出表；后续相同请求重新出网（不影响 SWR 后台校准与写后刷新）
  })
  inflight.set(key, p)
  return p
}

/** 实际出网逻辑 */
async function perform(name, action, payload, options) {
  const opts = options || {}
  const requestId = opts.requestId || requestIdFactory()
  const data = { action, payload: payload === undefined ? {} : payload, requestId }

  let result
  try {
    const params = { name, data }
    if (opts.timeout !== undefined) {
      params.timeout = opts.timeout
    }
    const res = await wx.cloud.callFunction(params)
    result = res && res.result
  } catch (err) {
    // 超时、云函数不存在、断网等 wx 层异常统一映射为可读错误
    const apiErr = new ApiError(NETWORK_ERROR_CODE, NETWORK_ERROR_MESSAGE)
    apiErr.cause = err && (err.errMsg || err.message) ? err.errMsg || err.message : String(err)
    throw apiErr
  }

  if (!result || typeof result.code !== 'number') {
    // 响应不符合 { code, message, data, requestId } 契约，按网络层异常处理
    throw new ApiError(NETWORK_ERROR_CODE, NETWORK_ERROR_MESSAGE)
  }

  if (result.code === 0) {
    return result.data
  }

  throw new ApiError(result.code, result.message, result.data)
}

/** 清空在途表 —— 测试接缝 */
function clearInflight() {
  inflight.clear()
}

module.exports = {
  call,
  ApiError,
  setRequestIdFactory,
  clearInflight,
  NETWORK_ERROR_CODE,
  NETWORK_ERROR_MESSAGE
}
