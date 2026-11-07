/**
 * 认证服务 — auth 云函数前端封装（详细设计 6.4）
 * 页面不得直连 wx.cloud.callFunction，登录状态统一由本模块出入
 */

const { call } = require('./api-client')

/**
 * 登录（自动注册）
 * @returns {Promise<{user: {openid:string,nickname:string,avatarFileID:string,profileComplete:boolean,createdAt:number}, isNew: boolean}>}
 */
async function login() {
  return call('auth', 'login', {})
}

/**
 * 更新昵称与头像
 * @param {{nickname: string, avatarFileID?: string}} input
 * @returns {Promise<object>} 更新后的 user
 */
async function updateProfile(input) {
  const payload = {
    nickname: input.nickname,
    avatarFileID: input.avatarFileID || ''
  }
  const res = await call('auth', 'updateProfile', payload)
  return res.user
}

/**
 * 上传头像到云存储
 * @param {string} tempFilePath - wx.chooseMedia/chooseAvatar 得到的临时路径
 * @returns {Promise<string>} fileID
 */
async function uploadAvatar(tempFilePath) {
  if (!tempFilePath) {
    throw new Error('缺少头像临时路径')
  }
  const app = getApp()
  const openid = app.globalData.user ? app.globalData.user.openid : 'anonymous'
  const cloudPath = `avatars/${openid}/${Date.now()}.png`
  const res = await wx.cloud.uploadFile({ cloudPath, filePath: tempFilePath })
  return res.fileID
}

module.exports = { login, updateProfile, uploadAvatar }
