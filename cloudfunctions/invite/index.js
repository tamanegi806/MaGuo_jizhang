/**
 * invite 云函数入口
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { dispatch } = require('./shared/response')
const handlers = require('./handlers')
const { createRepositories } = require('./repositories')
const { ENV_VERSION } = require('./config')

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const ctx = {
    openid: wxContext.OPENID,
    roomRepo: createRepositories(cloud.database()),
    cloud,
    envVersion: ENV_VERSION,
    now: () => Date.now(),
    log: console
  }
  return dispatch(event, handlers, ctx)
}
