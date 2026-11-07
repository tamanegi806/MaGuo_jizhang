/**
 * 麻将记账小程序入口
 */
const { CLOUD_ENV_ID } = require('./config/env')
const { login } = require('./services/auth-service')

App({
  onLaunch() {
    // 初始化云开发
    if (wx.cloud) {
      wx.cloud.init({
        env: CLOUD_ENV_ID || wx.cloud.DYNAMIC_CURRENT_ENV,
        traceUser: true
      })
    } else {
      console.error('请使用云开发基础库')
    }

    // 自动登录；页面跳转留待首页 onShow 处理（onLaunch 时机导航不可靠）
    this.globalData.loginReady = this.ensureLogin()
  },

  /**
   * 登录并把状态写入全局
   * @returns {Promise<object|null>} user，失败返回 null
   */
  async ensureLogin() {
    try {
      const { user } = await login()
      this.globalData.user = user
      this.globalData.needProfile = !user.profileComplete
      return user
    } catch (err) {
      console.error('登录失败:', err)
      this.globalData.loginError = err
      return null
    }
  },

  globalData: {
    cloudEnvId: CLOUD_ENV_ID,
    user: null,
    needProfile: false,
    loginReady: null,
    loginError: null
  }
})
