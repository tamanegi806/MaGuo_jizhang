/* !AUTO-GENERATED: 由 scripts/sync-shared.js 从 shared/ 同步生成，请勿直接编辑本文件 */
/**
 * 权限判定 — 纯函数，不依赖 wx、网络、页面
 */

/**
 * 判断能否查看牌局
 * @param {string} openid
 * @param {object|null} room
 * @returns {boolean}
 */
function canViewRoom(openid, room) {
  if (!room || !room.memberOpenids || !openid) return false
  return room.memberOpenids.includes(openid)
}

/**
 * 判断能否新增流水
 * @param {string} openid
 * @param {object|null} room
 * @returns {boolean}
 */
function canAddEntry(openid, room) {
  if (!room || !room.memberOpenids || !openid) return false
  return room.status === 'active' && room.memberOpenids.includes(openid)
}

/**
 * 判断能否结束牌局
 * @param {string} openid
 * @param {object|null} room
 * @returns {boolean}
 */
function canEndRoom(openid, room) {
  if (!room || !openid) return false
  return room.ownerOpenid === openid && room.status === 'active'
}

/**
 * 判断能否邀请成员
 * @param {string} openid
 * @param {object|null} room
 * @returns {boolean}
 */
function canInvite(openid, room) {
  if (!room || !room.memberOpenids || !openid) return false
  return room.status === 'active' && room.memberOpenids.includes(openid)
}

/**
 * 判断能否删除牌局记录（仅房主，且牌局须已结束；进行中的牌局不显示删除入口，v1.5）
 * @param {string} openid
 * @param {object|null} room
 * @returns {boolean}
 */
function canDeleteRoom(openid, room) {
  if (!room || !openid) return false
  return room.ownerOpenid === openid && room.status === 'ended'
}

module.exports = { canViewRoom, canAddEntry, canEndRoom, canInvite, canDeleteRoom }
