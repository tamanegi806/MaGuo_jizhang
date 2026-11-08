/**
 * 加入牌局（详细设计 6.2.3 / 7.2）
 * 三种进入方式：分享卡片 options.code、小程序码 options.scene（URL 编码 c=4821）、手动输入。
 * 有码自动加入并显示「正在加入…」；失败保留错误并展示手动输入框，避免卡死。
 * v2.0：邀请码为 4 位纯数字，旧 6 位字母数字码不再可加入。
 */

const roomService = require('../../services/room-service')
const inviteService = require('../../services/invite-service')
const { friendlyMessage } = require('../../utils/error-message')
const cache = require('../../utils/cache')

// 邀请码格式校验复用 shared 域规则（同步副本）
const inviteCode = require('../../shared/invite-code')

Page({
  data: {
    code: '',
    autoJoining: false, // 由 code/scene 触发自动加入
    submitting: false,
    error: null // { code, message }
  },

  onLoad(options) {
    let code = inviteService.parseJoinCode(options && options.code)
    if (!code) {
      code = inviteService.parseJoinScene(options && options.scene)
    }
    if (code) {
      this.setData({ code, autoJoining: true })
      this.doJoin(code)
    }
  },

  onInputCode(e) {
    this.setData({ code: e.detail.value, error: null })
  },

  /** 手动提交 */
  async tapJoin() {
    if (this.data.submitting) return
    const code = inviteService.parseJoinCode(this.data.code)
    this.setData({ code })
    if (!code) {
      this.setData({ error: { code: 'LOCAL', message: '请输入 4 位邀请码' } })
      return
    }
    if (!inviteCode.isValidCodeFormat(code)) {
      this.setData({ error: { code: 'LOCAL', message: friendlyMessage({ code: 4002 }) } })
      return
    }
    await this.doJoin(code)
  },

  async doJoin(code) {
    this.setData({ submitting: true, error: null })
    try {
      const res = await roomService.joinRoom(code)
      this.setData({ submitting: false, autoJoining: false })
      cache.remove(cache.keys.roomsList()) // 写时失效：新加入的牌局应出现在首页列表
      // 已是成员（res.alreadyMember=true）同样直接进入详情
      wx.redirectTo({ url: `/pages/room/room?id=${res.room.roomId}` })
    } catch (err) {
      // 自动加入失败后回到手动输入态，保留错误信息
      this.setData({
        submitting: false,
        autoJoining: false,
        error: { code: err.code, message: friendlyMessage(err) }
      })
    }
  }
})
