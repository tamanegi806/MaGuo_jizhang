/* !AUTO-GENERATED: 由 scripts/sync-shared.js 从 shared/ 同步生成，请勿直接编辑本文件 */
/**
 * 应用错误类与错误码定义
 */

/**
 * @typedef {object} AppErrorOptions
 * @property {number} code - 错误码
 * @property {string} [message] - 可选的错误描述
 */

const ErrorCodes = {
  // 认证相关 (1xxx)
  UNAUTHENTICATED: 1001,
  PROFILE_INCOMPLETE: 1002,
  INVALID_PROFILE: 1003,

  // 牌局相关 (2xxx)
  ROOM_NOT_FOUND: 2001,
  ROOM_ENDED: 2002,
  NOT_ROOM_MEMBER: 2003,
  NOT_ROOM_OWNER: 2004,
  ROOM_FULL: 2005,
  ROOM_NOT_ENDED: 2006,
  INVALID_INVITE_CODE: 2007,

  // 流水相关 (3xxx)
  INVALID_ENTRY: 3001,
  SAME_PAYER_PAYEE: 3002,
  INVALID_AMOUNT: 3003,
  INVALID_MEMBER: 3004,
  PAYER_NOT_SELF: 3005,

  // 参数校验 (4xxx)
  INVALID_PARAM: 4001,
  INVALID_INVITE_CODE_FORMAT: 4002,

  // 内部错误 (5xxx)
  INTERNAL_ERROR: 5001,
  QR_GENERATE_FAILED: 5002
}

Object.freeze(ErrorCodes)

/**
 * 应用自定义错误
 */
class AppError extends Error {
  /**
   * @param {number} code
   * @param {string} [message]
   * @param {*} [data] - 可选的附带数据，失败响应原样透传给客户端
   */
  constructor(code, message, data) {
    super(message || ErrorMessages[code] || 'Unknown error')
    this.code = code
    this.data = data
    Object.setPrototypeOf(this, AppError.prototype)
  }
}

/** 错误码映射表（供调试用） */
const ErrorMessages = {}
for (const [name, code] of Object.entries(ErrorCodes)) {
  ErrorMessages[code] = name
}

module.exports = { AppError, ErrorCodes }
