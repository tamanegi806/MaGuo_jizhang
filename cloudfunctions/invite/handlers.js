/**
 * invite 云函数处理器 — 小程序码生成
 * ctx = { openid, roomRepo, cloud, envVersion, now }
 */

function loadShared(name) {
  try {
    return require('../../shared/' + name)
  } catch (_) {
    return require('./shared/' + name)
  }
}

const { AppError, ErrorCodes } = loadShared('errors')
const { ROOM_STATUS_ACTIVE } = loadShared('constants')

const JOIN_PAGE = 'pages/join/join'
const SCENE_MAX = 32

/**
 * qr — 生成牌局小程序码并上传云存储
 * @param {{roomId:string}} payload
 * @param {object} ctx
 * @returns {Promise<{fileID:string, inviteCode:string, sharePath:string}>}
 */
async function qr(payload, ctx) {
  if (!ctx || !ctx.openid) {
    throw new AppError(ErrorCodes.UNAUTHENTICATED, 'UNAUTHENTICATED')
  }
  const roomId = (payload || {}).roomId
  if (!roomId || typeof roomId !== 'string') {
    throw new AppError(ErrorCodes.INVALID_PARAM, 'INVALID_PARAM')
  }

  const room = await ctx.roomRepo.findById(roomId)
  if (!room) throw new AppError(ErrorCodes.ROOM_NOT_FOUND, 'ROOM_NOT_FOUND')
  if (!room.memberOpenids.includes(ctx.openid)) {
    throw new AppError(ErrorCodes.NOT_ROOM_MEMBER, 'NOT_ROOM_MEMBER')
  }
  if (room.status !== ROOM_STATUS_ACTIVE) {
    throw new AppError(ErrorCodes.ROOM_ENDED, 'ROOM_ENDED')
  }

  const scene = `c=${room.inviteCode}`
  if (scene.length > SCENE_MAX) {
    // 6 位码不可能超长，防御数据损坏
    throw new AppError(ErrorCodes.INTERNAL_ERROR, 'scene exceeds 32 chars')
  }

  let buffer
  try {
    const result = await ctx.cloud.openapi.wxacode.getUnlimited({
      scene,
      page: JOIN_PAGE,
      checkPath: false,
      envVersion: ctx.envVersion,
      width: 430,
      autoColor: false,
      lineColor: { r: 0, g: 0, b: 0 },
      isHyaline: false
    })
    buffer = result && result.buffer
    if (!buffer) {
      throw new Error('empty buffer from wxacode.getUnlimited')
    }
  } catch (err) {
    throw new AppError(ErrorCodes.QR_GENERATE_FAILED, 'QR_GENERATE_FAILED', {
      reason: err.errMsg || err.message
    })
  }

  let fileID
  try {
    const uploaded = await ctx.cloud.uploadFile({
      cloudPath: `qrcodes/${roomId}/${ctx.envVersion}.png`,
      fileContent: buffer
    })
    fileID = uploaded.fileID
  } catch (err) {
    throw new AppError(ErrorCodes.QR_GENERATE_FAILED, 'QR_GENERATE_FAILED', {
      reason: err.errMsg || err.message
    })
  }

  return {
    fileID,
    inviteCode: room.inviteCode,
    sharePath: `/${JOIN_PAGE}?code=${room.inviteCode}`
  }
}

module.exports = { qr, JOIN_PAGE }
