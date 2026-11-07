/**
 * auth 云函数入口（详细设计 4.1 统一入口结构）
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { dispatch } = require('./shared/response')
const handlers = require('./handlers')
const { createRepositories } = require('./repositories')

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const ctx = {
    openid: wxContext.OPENID,
    userRepo: createRepositories(cloud.database()),
    now: () => Date.now(),
    cloud,
    log: console
  }
  return dispatch(event, handlers, ctx)
}
