/**
 * 记一笔（详细设计 6.2.5 / 6.7 / 7.3）
 * 进入页面生成 clientRequestId，重试复用、成功后换新；
 * 付款人默认当前用户；收款人排除付款人；成功后停留本页连续录入。
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
      const hasMe = members.some((m) => m.openid === me)
      const fromOpenid = hasMe
        ? me
        : room.ownerOpenid || (members[0] && members[0].openid) || ''
      this.setData({ loading: false, members, fromOpenid })
      this.updateDerived()
    } catch (err) {
      this.setData({ loading: false, error: { code: err.code, message: friendlyMessage(err) } })
    }
  },

  onFromChange(e) {
    const openid = (e.detail && e.detail.openid) || ''
    const patch = { fromOpenid: openid }
    // 付款人与当前收款人相同时清空收款人
    if (this.data.toOpenid === openid) patch.toOpenid = ''
    this.setData(patch)
    this.updateDerived()
  },

  onToChange(e) {
    this.setData({ toOpenid: (e.detail && e.detail.openid) || '' })
    this.updateDerived()
  },

  onAmountChange(e) {
    this.setData({ amountCents: e.detail.valueCents, saveError: '' })
    this.updateDerived()
  },

  /** 一键互换付款人/收款人；未选齐时禁用 */
  tapSwap() {
    if (!this.data.fromOpenid || !this.data.toOpenid) return
    const from = this.data.fromOpenid
    this.setData({ fromOpenid: this.data.toOpenid, toOpenid: from })
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
