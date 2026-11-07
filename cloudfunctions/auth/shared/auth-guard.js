/* !AUTO-GENERATED: 由 scripts/sync-shared.js 从 shared/ 同步生成，请勿直接编辑本文件 */
/**
 * 鉴权守卫 — 云函数公共层
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
 * 要求登录
 * @param {object} cloudData - 从 wx.cloud.callFunction 传入的用户数据
 * @throws {AppError} 未登录时抛出
 */
function requireLogin(cloudData) {
  if (!cloudData || !cloudData.openid) {
    throw new AppError(ErrorCodes.UNAUTHENTICATED, 'UNAUTHENTICATED')
  }
  return cloudData
}

/**
 * 要求是牌局成员
 * @param {object} cloudData
 * @param {string} roomId
 * @param {object} roomRepo
 * @throws {AppError}
 */
async function requireMember(cloudData, roomId, roomRepo) {
  requireLogin(cloudData)
  const room = await roomRepo.findById(roomId)
  if (!room) {
    throw new AppError(ErrorCodes.ROOM_NOT_FOUND, 'ROOM_NOT_FOUND')
  }
  if (!room.memberOpenids || !room.memberOpenids.includes(cloudData.openid)) {
    throw new AppError(ErrorCodes.NOT_ROOM_MEMBER, 'NOT_ROOM_MEMBER')
  }
  return room
}

/**
 * 要求是房主
 * @param {object} cloudData
 * @param {string} roomId
 * @param {object} roomRepo
 * @throws {AppError}
 */
async function requireOwner(cloudData, roomId, roomRepo) {
  requireLogin(cloudData)
  const room = await roomRepo.findById(roomId)
  if (!room) {
    throw new AppError(ErrorCodes.ROOM_NOT_FOUND, 'ROOM_NOT_FOUND')
  }
  if (room.ownerOpenid !== cloudData.openid) {
    throw new AppError(ErrorCodes.NOT_ROOM_OWNER, 'NOT_ROOM_OWNER')
  }
  return room
}

/**
 * 要求牌局处于 active 状态
 * @param {object} room
 * @throws {AppError}
 */
function requireActive(room) {
  if (room.status === 'ended') {
    throw new AppError(ErrorCodes.ROOM_ENDED, 'ROOM_ENDED')
  }
  return room
}

module.exports = { requireLogin, requireMember, requireOwner, requireActive }
