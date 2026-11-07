/**
 * 参数校验工具 — 云函数公共层
 * 自动生成，请勿修改（由 sync-shared.js 管理）
 */

// 部署后与 errors.js 同目录（<云函数>/shared/）；本地回退到项目根 shared/
let errorsMod
try {
  errorsMod = require('./errors')
} catch (_) {
  errorsMod = require('../../shared/errors')
}
const { AppError, ErrorCodes } = errorsMod

/**
 * 校验字段非空
 * @param {*} value
 * @param {string} fieldName
 * @throws {AppError}
 */
function required(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    throw new AppError(ErrorCodes.INVALID_PARAM, `${fieldName} is required`)
  }
  return true
}

/**
 * 校验字符串长度
 * @param {string} str
 * @param {number} min
 * @param {number} max
 * @throws {AppError}
 */
function stringLength(str, min, max, fieldName) {
  if (typeof str !== 'string') {
    throw new AppError(ErrorCodes.INVALID_PARAM, `${fieldName} must be a string`)
  }
  if (str.length < min || str.length > max) {
    throw new AppError(ErrorCodes.INVALID_PARAM, `${fieldName} length must be between ${min} and ${max}`)
  }
  return true
}

/**
 * 校验整数
 * @param {*} value
 * @param {string} fieldName
 * @throws {AppError}
 */
function integer(value, fieldName) {
  if (!Number.isInteger(value)) {
    throw new AppError(ErrorCodes.INVALID_PARAM, `${fieldName} must be an integer`)
  }
  return true
}

/**
 * 校验 openid 格式
 * @param {string} openid
 * @throws {AppError}
 */
function openId(openid) {
  required(openid, 'openid')
  if (!/^o[a-zA-Z0-9_-]{10,}$/.test(openid)) {
    throw new AppError(ErrorCodes.INVALID_PARAM, 'Invalid openid format')
  }
  return true
}

/**
 * 校验 memberOpenids 数组
 * @param {string[]} list
 * @throws {AppError}
 */
function memberOpenids(list) {
  required(list, 'memberOpenids')
  if (!Array.isArray(list)) {
    throw new AppError(ErrorCodes.INVALID_PARAM, 'memberOpenids must be an array')
  }
  for (const id of list) {
    openId(id)
  }
  return true
}

/**
 * 校验幂等键格式
 * @param {string} requestId
 * @throws {AppError}
 */
function requestId(requestId) {
  required(requestId, 'clientRequestId')
  stringLength(requestId, 8, 64, 'clientRequestId')
  return true
}

module.exports = { required, stringLength, integer, openId, memberOpenids, requestId }
