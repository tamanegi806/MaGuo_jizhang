/**
 * 记一笔（详细设计 6.2.5 / 6.7 / 7.3）
 * 进入页面生成 clientRequestId，重试复用、成功后换新；
 * v1.6：付款人固定为当前用户（只允许「自己→他人」，无房主特权），不提供付款人选择与交换；
 * 支持 options.payee（点好友头像进入时）预置收款人。
 */

const roomService = require('../../services/room-service')
const entryService = require('../../services/entry-service')
const { uuidv4 } = require('../../utils/uuid')
const { friendlyMessage } = require('../../utils/error-message')
const { formatCents } = require('../../shared/money')
const { ErrorCodes } = require('../../shared/errors')

Page({
  data: {
    roomId: '',
    loading: true,
    error: null, // { code, message } 页面级（加载失败）
    members: [],
    fromOpenid: '',
    toOpenid: '',
    meName: '',
    meAvatar: '',
    amountCents: 0,
    amountValue: 0, // 回填 amount-input；0 表示清空
    clientRequestId: '',
    submitting: false,
    canSave: false,
    preview: { fromName: '', toName: '', amountText: '' },
    saveError: '' // 保存失败提示（保留输入）
  },

  onLoad(options) {
    const roomId = options && options.roomId
    if (!roomId) {
      this.setData({ loading: false, error: { code: 'LOCAL', message: '缺少牌局参数' } })
      return
    }
    // 由详情页点好友头像进入时，预置收款人为该好友
    this._presetPayee = (options && options.payee) || ''
    // 每次进入页面生成幂等键；保存成功后为下一笔重新生成
    this.setData({ roomId, clientRequestId: uuidv4() })
    this.loadRoom()
  },

  async loadRoom() {
    this.setData({ loading: true, error: null })
    try {
      const res = await roomService.getRoomDetail(this.data.roomId)
      const room = res.room
      const permissions = res.permissions || {}
      // 已结束或无权限 → 阻止进入，返回详情（只读态）
      if (room.status !== 'active' || !permissions.canAddEntry) {
        wx.showToast({
          title: room.status !== 'active' ? '牌局已结束，无法再记账' : '你暂无记账权限',
          icon: 'none'
        })
        wx.navigateBack()
        return
      }
      const members = res.members || []
      const me = ((getApp().globalData || {}).user || {}).openid || ''
      // v1.6：付款人恒为自己（非成员已被上方权限拦截；服务端另有权威校验兜底）
      const fromOpenid = me
      const meMember = members.find((m) => m.openid === me) || {}
      // 预置收款人：仅当其为牌局成员且不是自己
      const presetValid =
        this._presetPayee &&
        this._presetPayee !== fromOpenid &&
        members.some((m) => m.openid === this._presetPayee)
      const toOpenid = presetValid ? this._presetPayee : ''
      this.setData({
        loading: false,
        members,
        fromOpenid,
        toOpenid,
        meName: meMember.nickname || '我',
        meAvatar: meMember.avatarFileID || ''
      })
      this.updateDerived()
    } catch (err) {
      this.setData({ loading: false, error: { code: err.code, message: friendlyMessage(err) } })
    }
  },

  onToChange(e) {
    this.setData({ toOpenid: (e.detail && e.detail.openid) || '' })
    this.updateDerived()
  },

  onAmountChange(e) {
    this.setData({ amountCents: e.detail.valueCents, saveError: '' })
    this.updateDerived()
  },

  nameOf(openid) {
    if (!openid) return ''
    const m = this.data.members.find((x) => x.openid === openid)
    return m ? m.nickname || openid : openid
  },

  updateDerived() {
    const { fromOpenid, toOpenid, amountCents } = this.data
    const canSave = Boolean(fromOpenid && toOpenid && fromOpenid !== toOpenid && amountCents > 0)
    this.setData({
      canSave,
      preview: {
        fromName: this.nameOf(fromOpenid),
        toName: this.nameOf(toOpenid),
        amountText: amountCents > 0 ? formatCents(amountCents, { currency: true }) : ''
      }
    })
  },

  async onSave() {
    if (!this.data.canSave || this.data.submitting) return
    this.setData({ submitting: true, saveError: '' })
    try {
      await entryService.addEntry({
        roomId: this.data.roomId,
        fromOpenid: this.data.fromOpenid,
        toOpenid: this.data.toOpenid,
        amountCents: this.data.amountCents,
        clientRequestId: this.data.clientRequestId
      })
      // 成功：保留付款人，清空收款人与金额，为下一笔换新幂等键
      // amountValue 先落到当前值再归 0，确保 amount-input 的 value observer 触发清空
      const spentCents = this.data.amountCents
      this.setData({ submitting: false, toOpenid: '', amountCents: 0, amountValue: spentCents })
      this.setData({ amountValue: 0, clientRequestId: uuidv4() })
      wx.showToast({ title: '已记录', icon: 'success' })
      this.updateDerived()
    } catch (err) {
      // 失败：保留输入与 clientRequestId（重试复用）
      this.setData({ submitting: false, saveError: friendlyMessage(err) })
      const fatal = err.code === ErrorCodes.ROOM_ENDED || err.code === ErrorCodes.NOT_ROOM_MEMBER
      if (fatal) {
        // 已结束/非成员 → 返回详情只读态
        setTimeout(() => wx.navigateBack(), 600)
      }
    }
  },

  tapDone() {
    wx.navigateBack()
  },

  tapRetry() {
    this.loadRoom()
  }
})
