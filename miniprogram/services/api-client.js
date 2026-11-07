/**
 * 云函数调用封装 — 前端唯一出云通道
 * 页面与服务不得直接调用 wx.cloud.callFunction，统一经此模块（详细设计 6.4、禁止事项第 7 条）
 */

const { uuidv4 } = require('../utils/uuid')

const NETWORK_ERROR_CODE = 'NETWORK_ERROR'
const NETWORK_ERROR_MESSAGE = '网络异常，请检查连接'

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
 * 调用云函数并解包统一响应
 * @param {string} name 云函数名
 * @param {string} action 动作
 * @param {object} [payload] 业务参数
 * @param {{requestId?: string, timeout?: number}} [options]
 * @returns {Promise<any>} 成功时的 data
 * @throws {ApiError}
 */
async function call(name, action, payload, options) {
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

module.exports = { call, ApiError, setRequestIdFactory, NETWORK_ERROR_CODE, NETWORK_ERROR_MESSAGE }
