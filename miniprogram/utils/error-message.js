/**
 * 页面统一错误文案 — 将 ApiError/AppError 映射为中文提示
 * 未知/内部错误统一兜底，不向用户暴露内部枚举名与堆栈。
 */

const { ErrorCodes } = require('../shared/errors')
const { MAX_MEMBERS } = require('../shared/constants')

const CODE_MESSAGES = {
  [ErrorCodes.UNAUTHENTICATED]: '登录已失效，请重试',
  [ErrorCodes.PROFILE_INCOMPLETE]: '请先完善昵称',
  [ErrorCodes.INVALID_PROFILE]: '昵称或头像不符合要求',
  [ErrorCodes.ROOM_NOT_FOUND]: '牌局不存在或已被删除',
  [ErrorCodes.ROOM_ENDED]: '牌局已结束，数据仅可查看',
  [ErrorCodes.NOT_ROOM_MEMBER]: '你不在该牌局中',
  [ErrorCodes.NOT_ROOM_OWNER]: '只有房主可以操作',
  [ErrorCodes.ROOM_FULL]: `牌局人数已满（最多 ${MAX_MEMBERS} 人）`,
  [ErrorCodes.ROOM_NOT_ENDED]: '牌局进行中，请先结束牌局再删除',
  [ErrorCodes.INVALID_INVITE_CODE]: '邀请码无效，请向好友确认',
  [ErrorCodes.INVALID_ENTRY]: '流水信息不合法',
  [ErrorCodes.SAME_PAYER_PAYEE]: '付款人和收款人不能是同一人',
  [ErrorCodes.INVALID_AMOUNT]: '请输入大于 0 的金额',
  [ErrorCodes.INVALID_MEMBER]: '成员选择无效，请重新选择',
  [ErrorCodes.PAYER_NOT_SELF]: '只能记录自己付出去的流水',
  [ErrorCodes.INVALID_PARAM]: '操作有误，请重试',
  [ErrorCodes.INVALID_INVITE_CODE_FORMAT]: '邀请码应为 4 位数字',
  [ErrorCodes.INTERNAL_ERROR]: '服务异常，请稍后再试',
  [ErrorCodes.QR_GENERATE_FAILED]: '小程序码生成失败'
}

const NETWORK_MESSAGE = '网络异常，请检查连接'
const GENERIC_MESSAGE = '操作失败，请重试'

/**
 * 错误 -> 用户可读文案
 * @param {*} err ApiError / Error / 任意值
 * @returns {string}
 */
function friendlyMessage(err) {
  if (!err) return GENERIC_MESSAGE
  if (err.code === 'NETWORK_ERROR') return NETWORK_MESSAGE
  if (typeof err.code === 'number' && CODE_MESSAGES[err.code]) {
    return CODE_MESSAGES[err.code]
  }
  const msg = typeof err.message === 'string' ? err.message : ''
  // 内部枚举名（全大写+下划线）不外泄
  if (msg && !/^[A-Z][A-Z0-9_]*$/.test(msg)) return msg
  return GENERIC_MESSAGE
}

module.exports = { friendlyMessage, CODE_MESSAGES, NETWORK_MESSAGE, GENERIC_MESSAGE }
