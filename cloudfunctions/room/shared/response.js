/* !AUTO-GENERATED: 由 scripts/sync-shared.js 从 shared/ 同步生成，请勿直接编辑本文件 */
/**
 * 统一响应格式 — 云函数公共层
 *
 * 契约（详细设计 4.1）：
 *   请求 event = { action, payload, requestId }
 *   响应 body  = { code, message, data, requestId }
 *   code === 0 成功；非 0 为业务错误码，data 可选携带错误详情。
 */

// 部署后本文件位于 <云函数>/shared/，与 errors.js 同目录；
// 本地仓库中位于 cloudfunctions/_shared/，需回退到项目根 shared/。
let errorsMod
try {
  errorsMod = require('./errors')
} catch (_) {
  errorsMod = require('../../shared/errors')
}
const { AppError, ErrorCodes } = errorsMod

/**
 * 构建成功响应
 * @param {*} data
 * @param {string} [requestId]
 * @returns {{code:0,message:string,data:any,requestId:(string|undefined)}}
 */
function ok(data, requestId) {
  return { code: 0, message: 'ok', data: data === undefined ? null : data, requestId }
}

/**
 * 构建失败响应
 * @param {AppError|Error} error
 * @param {string} [requestId]
 * @returns {{code:number,message:string,data:any,requestId:(string|undefined)}}
 */
function fail(error, requestId) {
  const code = error && typeof error.code === 'number' ? error.code : ErrorCodes.INTERNAL_ERROR
  const message = (error && error.message) || 'fail'
  const res = { code, message, data: null, requestId }
  if (error && error.data !== undefined) {
    res.data = error.data
  }
  return res
}

/**
 * 根据 event.action 分发到对应处理器
 * 处理器签名：async function handler(payload, ctx)
 * @param {{action:string,payload:object,requestId:string}} event
 * @param {Record<string,(payload:object,ctx:object)=>any>} handlers
 * @param {object} ctx - { openid, db, cloud, now, log }
 * @returns {Promise<{code:number,message:string,data:any,requestId}>}
 */
async function dispatch(event, handlers, ctx) {
  const { action, payload, requestId } = event || {}

  const handler = handlers && handlers[action]
  if (typeof handler !== 'function') {
    return fail(new AppError(ErrorCodes.INVALID_PARAM, `Unknown action: ${action}`), requestId)
  }

  try {
    const data = await handler(payload, ctx)
    return ok(data, requestId)
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err, requestId)
    }
    console.error('[dispatch]', err)
    // 未捕获异常统一 INTERNAL_ERROR，不向客户端暴露堆栈
    return fail(new AppError(ErrorCodes.INTERNAL_ERROR, 'Internal error'), requestId)
  }
}

module.exports = { ok, fail, dispatch }
