/**
 * entry 云函数入口
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
    now: () => Date.now(),
    cloud,
    log: console
  }
  return dispatch(event, handlers, ctx)
}
