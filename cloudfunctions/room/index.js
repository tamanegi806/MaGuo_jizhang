/**
 * room 云函数入口
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { dispatch } = require('./shared/response')
const handlers = require('./handlers')
const { createRepositories } = require('./repositories')

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const db = cloud.database()
  const _ = db.command
  const repos = createRepositories(db, _)

  const ctx = {
    openid: wxContext.OPENID,
    roomRepo: repos,
    userRepo: repos,
    entryRepo: repos,
    computeSettlement: require('./shared/settlement').computeSettlement,
    now: () => Date.now(),
    cloud,
    log: console
  }

  // v2.6：定时器触发（config.json 的 autoEndIdle）走专用分发，标记 source 供 handler 鉴权
  if (event && event.Type === 'Timer') {
    ctx.source = 'timer'
    return dispatch({ action: 'autoEndIdle', payload: {}, requestId: event.TriggerName }, handlers, ctx)
  }

  return dispatch(event, handlers, ctx)
}
