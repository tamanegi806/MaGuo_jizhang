/**
 * 流水服务 — entry 云函数前端封装（详细设计 6.4）
 */

const { call } = require('./api-client')

/**
 * 新增流水
 * clientRequestId 必传：打开记账弹层时生成，失败重试必须复用同一值；服务层不做隐式新键
 * @param {{roomId:string, fromOpenid:string, toOpenid:string, amountCents:number, clientRequestId:string}} input
 * @returns {Promise<{entry:object, duplicated:boolean}>}
 */
async function addEntry(input) {
  if (!input || !input.clientRequestId) {
    throw new Error('addEntry 需要页面传入 clientRequestId（服务层不隐式生成）')
  }
  return call('entry', 'add', {
    roomId: input.roomId,
    fromOpenid: input.fromOpenid,
    toOpenid: input.toOpenid,
    amountCents: input.amountCents,
    clientRequestId: input.clientRequestId
  })
}

/**
 * 流水列表（分页）
 * @param {{roomId:string, page?:number, pageSize?:number}} input
 * @returns {Promise<{items:object[], page:number, hasMore:boolean}>}
 */
async function listEntries(input) {
  return call('entry', 'list', {
    roomId: input.roomId,
    page: input.page || 0,
    pageSize: input.pageSize || 20
  })
}

module.exports = { addEntry, listEntries }
