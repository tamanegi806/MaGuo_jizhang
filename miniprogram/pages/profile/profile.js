/**
 * 完善资料（详细设计 6.2.6 / 7.1）
 * 头像 chooseAvatar → 上传云存储；昵称 type="nickname"；
 * 首次进入可「稍后再说」：生成临时昵称并保存兜底。
 * v2.7：隐私授权前置到进入本页时（原来是填完昵称再点保存才被拦一次），并给出《隐私保护指引》入口；
 * 上传头像与保存昵称各留一道兜底检查，避免用户还没同意就把头像传上云。
 * 网络与上传均走 services/auth-service。
 */

const authService = require('../../services/auth-service')
const privacy = require('../../utils/privacy')
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
    // v2.7：进页面就把隐私弹窗问掉，别等用户填完昵称再拦（此时还没有任何采集动作）
    this.ensurePrivacy()
  },

  /** 头像选择（open-type=chooseAvatar）；实际上传前还要过一次授权 */
  onChooseAvatar(e) {
    const tempPath = e.detail && e.detail.avatarUrl
    if (!tempPath) return
    this.setData({ avatarTempPath: tempPath })
    this.uploadAvatar(tempPath)
  },

  /**
   * 上传头像到云存储（未同意隐私授权时直接返回，不发出上传）
   * @param {string} tempFilePath - wx.chooseMedia/chooseAvatar 得到的临时路径
   * @returns {Promise<string|undefined>} fileID；被授权拦下时为 undefined
   */
  async uploadAvatar(tempFilePath) {
    // 未同意授权就不把图片传出手机：本地预览（avatarTempPath）不算采集，允许保留
    if (!(await this.ensurePrivacy())) return
    this.setData({ uploading: true })
    try {
      const fileID = await authService.uploadAvatar(tempFilePath)
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
   * 隐私授权前置（v2.7 起统一走 utils/privacy：在途共享、基础库不支持时视为已同意）
   * 拒绝则中止采集动作（上传头像 / 保存昵称），但不锁死本页与其他功能。
   * @returns {Promise<boolean>} 是否可继续
   */
  async ensurePrivacy() {
    const { ok, error } = await privacy.ensurePrivacy()
    if (!ok) this.setData({ error })
    return ok
  },

  /**
   * 查看《小程序用户隐私保护指引》正文（微信后台「服务内容声明」里填的就是这一页，无需自建协议页）
   * 老基础库没有 openPrivacyContract：给一句可操作的提示，不静默失败。
   */
  async tapPrivacyContract() {
    if (await privacy.openPrivacyContract()) return
    wx.showToast({ title: '当前微信版本过低，无法查看指引', icon: 'none' })
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

    // 兜底：授权一般在进页面时就问过了，这里防的是「弹窗刚被拒绝就直接按保存」
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
