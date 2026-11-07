/**
 * 邀请服务 — 小程序码、分享路径、扫码参数解析（详细设计 6.4）
 */

const { call } = require('./api-client')

/**
 * 生成牌局小程序码
 * @param {string} roomId
 * @returns {Promise<{fileID:string, inviteCode:string, sharePath:string}>}
 */
async function getRoomQr(roomId) {
  return call('invite', 'qr', { roomId })
}

/**
 * 分享路径（用于 onShareAppMessage / 按钮）
 * @param {string} inviteCode
 * @returns {string}
 */
function getSharePath(inviteCode) {
  return `/pages/join/join?code=${encodeURIComponent(inviteCode || '')}`
}

/**
 * 分享消息
 * @param {{name:string, inviteCode:string}} room
 * @returns {{title:string, path:string}}
 */
function getShareMessage(room) {
  return {
    title: `邀你加入牌局「${room && room.name ? room.name : '麻将记账'}」`,
    path: getSharePath(room && room.inviteCode)
  }
}

/**
 * 解析扫码进入的 scene 参数
 * 兼容 URL 编码：'c%3DA7K2M9' 与 'c=A7K2M9'；非法返回空串
 * @param {string} scene
 * @returns {string} 邀请码或 ''
 */
function parseJoinScene(scene) {
  if (!scene || typeof scene !== 'string') return ''
  let decoded = scene
  try {
    decoded = decodeURIComponent(scene)
  } catch (_) {
    /* 含非法转义序列时按原文解析 */
  }
  const m = decoded.match(/^c=([0-9A-Za-z]+)$/)
  if (!m) return ''
  return m[1].toUpperCase()
}

/**
 * 解析分享链接进入加入页的 query.code 参数
 * @param {string} code
 * @returns {string} 规范化邀请码或 ''
 */
function parseJoinCode(code) {
  if (!code || typeof code !== 'string') return ''
  const normalized = code.trim().toUpperCase()
  return normalized
}

module.exports = { getRoomQr, getSharePath, getShareMessage, parseJoinScene, parseJoinCode }
