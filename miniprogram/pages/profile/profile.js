/**
 * 完善资料（详细设计 6.2.6 / 7.1）
 * 头像 chooseAvatar → 上传云存储；昵称 type="nickname"；
 * 首次进入可「稍后再说」：生成临时昵称并保存兜底。
 * 网络与上传均走 services/auth-service，隐私授权为可选前置。
 */

const authService = require('../../services/auth-service')
const { friendlyMessage } = require('../../utils/error-message')
const { tempNickname, NICKNAME_MAX_LEN } = require('../../shared/user')

Page({
  data: {
    nickname: '',
    avatarFileID: '',
    avatarTempPath: '', // 本地预览路径（上传前）
    nicknameError: '',
    uploading: false,
    submitting: false,
    isInitial: false, // 首登进入：显示「稍后再说」
    error: null // { code, message } 页面级提示
  },

  onLoad() {
    const app = getApp()
    const user = (app.globalData && app.globalData.user) || null
    this.setData({
      isInitial: Boolean(app.globalData && app.globalData.needProfile),
      nickname: user && user.nickname ? user.nickname : '',
      avatarFileID: user && user.avatarFileID ? user.avatarFileID : ''
    })
  },

  /** 头像选择（open-type=chooseAvatar） */
  onChooseAvatar(e) {
    const tempPath = e.detail && e.detail.avatarUrl
    if (!tempPath) return
    this.setData({ avatarTempPath: tempPath })
    this.uploadAvatar(tempPath)
  },

  async uploadAvatar(tempPath) {
    this.setData({ uploading: true })
    try {
      const fileID = await authService.uploadAvatar(tempPath)
      this.setData({ uploading: false, avatarFileID: fileID })
    } catch (err) {
      this.setData({
        uploading: false,
        error: { code: err.code, message: friendlyMessage(err) || '头像上传失败' }
      })
    }
  },

  onInputNickname(e) {
    this.setData({ nickname: e.detail.value, nicknameError: '' })
  },

  validateNickname() {
    const nickname = (this.data.nickname || '').trim()
    if (!nickname) {
      this.setData({ nicknameError: '请输入昵称' })
      return null
    }
    if (nickname.length > NICKNAME_MAX_LEN) {
      this.setData({ nicknameError: `昵称最多 ${NICKNAME_MAX_LEN} 个字` })
      return null
    }
    return nickname
  },

  /**
   * 隐私授权前置（基础库支持时；拒绝则中止保存）
   * @returns {Promise<boolean>} 是否可继续
   */
  async ensurePrivacy() {
    if (typeof wx.requirePrivacyAuthorize !== 'function') return true
    try {
      await new Promise((resolve, reject) =>
        wx.requirePrivacyAuthorize({ success: resolve, fail: reject })
      )
      return true
    } catch (_) {
      this.setData({ error: { code: 'PRIVACY', message: '需要同意隐私保护指引后才能继续' } })
      return false
    }
  },

  /**
   * 保存
   * @param {{tempFallback?: boolean}} [opts] 稍后再说：用临时昵称兜底
   */
  async onSave({ tempFallback = false } = {}) {
    if (this.data.submitting) return
    const app = getApp()

    let nickname
    if (tempFallback) {
      const openid = ((app.globalData.user || {}).openid) || ''
      nickname = tempNickname(openid)
    } else {
      nickname = this.validateNickname()
      if (!nickname) return
    }

    if (!(await this.ensurePrivacy())) return

    this.setData({ submitting: true, error: null })
    try {
      const user = await authService.updateProfile({
        nickname,
        avatarFileID: this.data.avatarFileID
      })
      app.globalData.user = user
      app.globalData.needProfile = !user.profileComplete
      this.setData({ submitting: false })
      wx.showToast({ title: '已保存', icon: 'success' })
      wx.navigateBack()
    } catch (err) {
      this.setData({
        submitting: false,
        error: { code: err.code, message: friendlyMessage(err) }
      })
    }
  },

  tapSave() {
    this.onSave()
  },

  /** 稍后再说：临时昵称兜底保存 */
  tapLater() {
    this.onSave({ tempFallback: true })
  },

  tapBack() {
    wx.navigateBack()
  }
})
