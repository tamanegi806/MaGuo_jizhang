/**
 * 牌局服务 — room 云函数前端封装（详细设计 6.4）
 */

const { call } = require('./api-client')

/**
 * 创建牌局
 * clientRequestId 由页面首次提交时生成，失败重试必须复用同一值；服务层不做隐式新键
 * name 可选（v1.4 起默认不传，牌局以创建时间标识）
 * @param {{clientRequestId:string, name?:string}} input
 * @returns {Promise<{room:object}>}
 */
async function createRoom(input) {
  if (!input || !input.clientRequestId) {
    throw new Error('createRoom 需要页面传入 clientRequestId（服务层不隐式生成）')
  }
  const payload = { clientRequestId: input.clientRequestId }
  if (input.name) payload.name = input.name
  return call('room', 'create', payload)
}

/**
 * 邀请码加入牌局
 * @param {string} inviteCode
 */
async function joinRoom(inviteCode) {
  return call('room', 'join', { inviteCode })
}

/**
 * 牌局列表（分页）
 * @param {{page?:number, pageSize?:number}} [input]
 */
async function listRooms(input = {}) {
  return call('room', 'list', {
    page: input.page || 0,
    pageSize: input.pageSize || 20
  })
}

/**
 * 牌局详情
 * @param {string} roomId
 */
async function getRoomDetail(roomId) {
  return call('room', 'detail', { roomId })
}

/**
 * 结束牌局
 * @param {string} roomId
 */
async function endRoom(roomId) {
  return call('room', 'end', { roomId })
}

/**
 * 删除牌局记录（仅房主；连带清除全部输赢流水，不可恢复）
 * @param {string} roomId
 */
async function deleteRoom(roomId) {
  return call('room', 'remove', { roomId })
}

module.exports = { createRoom, joinRoom, listRooms, getRoomDetail, endRoom, deleteRoom }
