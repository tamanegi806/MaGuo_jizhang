/**
 * 流水输出格式化 — 云函数公共层
 * 为流水附加付款人/收款人昵称与头像、金额文本
 */

// 本地源码位于 _shared/，money 在项目根 shared/；同步副本位于 <fn>/shared/ 与 money 同目录
const moneyMod = (() => {
  try {
    return require('./money')
  } catch (_) {
    return require('../../shared/money')
  }
})()
const { formatCents } = moneyMod

// 本地源码位于 _shared/，user 在项目根 shared/；同步副本位于 <fn>/shared/ 与 money 同目录
const userMod = (() => {
  try {
    return require('../../shared/user')
  } catch (_) {
    return require('./user')
  }
})()

/**
 * 临时昵称：玩家 + openid 后 4 位（域规则单一来源 shared/user.js）
 */
const tempNickname = userMod.tempNickname

/**
 * 取用户昵称，空昵称回退临时昵称
 * @param {object|null} user
 * @param {string} openid
 * @returns {string}
 */
function nicknameOf(user, openid) {
  return (user && user.nickname) || tempNickname(openid)
}

/**
 * 格式化单条流水输出
 * @param {object} entry - { _id/entryId, roomId, fromOpenid, toOpenid, amountCents, createdBy, createdAt }
 * @param {Map<string, object>} usersById - openid -> user 资料
 * @returns {object}
 */
function formatEntry(entry, usersById) {
  const fromUser = usersById.get(entry.fromOpenid) || null
  const toUser = usersById.get(entry.toOpenid) || null
  return {
    entryId: entry.entryId || entry._id,
    roomId: entry.roomId,
    fromOpenid: entry.fromOpenid,
    fromNickname: nicknameOf(fromUser, entry.fromOpenid),
    fromAvatarFileID: (fromUser && fromUser.avatarFileID) || '',
    toOpenid: entry.toOpenid,
    toNickname: nicknameOf(toUser, entry.toOpenid),
    toAvatarFileID: (toUser && toUser.avatarFileID) || '',
    amountCents: entry.amountCents,
    amountText: formatCents(entry.amountCents, { currency: true }),
    createdBy: entry.createdBy,
    createdAt: entry.createdAt
  }
}

module.exports = { tempNickname, nicknameOf, formatEntry }
