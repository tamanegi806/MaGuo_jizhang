/* !AUTO-GENERATED: 由 scripts/sync-shared.js 从 shared/ 同步生成，请勿直接编辑本文件 */
/**
 * 用户域约定 — 临时昵称兜底（详细设计 6.7 第 11 条）
 * 纯函数，无 wx/getApp 依赖；云端与小程序共用同步副本。
 */

/** 昵称最大长度（与 auth 云函数校验一致） */
const NICKNAME_MAX_LEN = 20

/**
 * 「稍后再说」兜底昵称：玩家 + openid 后 4 位
 * @param {string} openid
 * @returns {string}
 */
function tempNickname(openid) {
  const suffix = String(openid || '').slice(-4)
  return `玩家${suffix}`
}

module.exports = { tempNickname, NICKNAME_MAX_LEN }
