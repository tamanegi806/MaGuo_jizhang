/**
 * 牌局详情（详细设计 6.2.4 / 6.7 / 7.2-7.5）
 * 数据：roomService.getRoomDetail + entryService.listEntries 分页；
 * 进行中每 10 秒轮询（onHide/onUnload/已结束停止）；
 * 邀请：打开弹层时才生成小程序码；结束：确认框 → endRoom → 只读；
 * 成员：头像下方显示当前盈亏；点好友头像快捷记一笔（收款人预置为该好友）；
 * 删除：房主可删除牌局记录（连同全部流水，需二次确认）。
 */

const roomService = require('../../services/room-service')
const entryService = require('../../services/entry-service')
const inviteService = require('../../services/invite-service')
const { friendlyMessage } = require('../../utils/error-message')
const { formatDateTime } = require('../../utils/date')
const { formatCents } = require('../../shared/money')
const { ErrorCodes } = require('../../shared/errors')
const { ROOM_POLL_INTERVAL_MS: POLL_INTERVAL_MS } = require('../../config/env')

const ENTRY_PAGE_SIZE = 20

/** 净额 → 头像下方展示（正红负绿灰零，符号在文本中） */
function toPlDisplay(totalCents) {
  const total = Number.isInteger(totalCents) ? totalCents : 0
  return {
    plText: formatCents(total, { sign: 'always', currency: true }),
    plTone: total > 0 ? 'plus' : total < 0 ? 'minus' : 'zero'
  }
}

Page({
  data: {
    roomId: '',
    meOpenid: '',
    loading: true,
    error: null, // { code, message }
    room: null, // { roomId,name,inviteCode,ownerOpenid,status,memberCount,createdAt,endedAt }
    members: [],
    settlement: [],
    entries: [],
    entriesPage: 1, // recentEntries 已覆盖第 0 页
    entriesHasMore: false,
    loadingMore: false,
    permissions: null, // { canAddEntry, canEndRoom, canInvite, canDeleteRoom }
    createdAtStr: '',
    endedReadonly: false,
    submitting: false,
    // 邀请弹层
    inviteVisible: false,
    inviteCode: '',
    qrFileID: '',
    qrLoading: false,
    qrError: ''
  },

  _pollTimer: null,
  _pendingOpenInvite: false,

  onLoad(options) {
    const roomId = options && options.id
    if (!roomId) {
      this.setData({ loading: false, error: { code: 'LOCAL', message: '缺少牌局参数' } })
      return
    }
    this._pendingOpenInvite = options.openInvite === '1'
    const app = getApp()
    const meOpenid = ((app && app.globalData && app.globalData.user) || {}).openid || ''
    this.setData({ roomId, meOpenid })
  },

  onShow() {
    if (!this.data.roomId) return
    this.loadDetail({ silent: Boolean(this.data.room) })
  },

  onHide() {
    this.stopPolling()
  },

  onUnload() {
    this.stopPolling()
  },

  /**
   * 拉取详情（静默失败时保留旧数据）
   * @param {{silent?: boolean}} [opts]
   */
  async loadDetail({ silent = false } = {}) {
    if (!silent) this.setData({ loading: true, error: null })
    try {
      const res = await roomService.getRoomDetail(this.data.roomId)
      const room = res.room
      const recent = res.recentEntries || []
      const permissions = res.permissions || {}
      // 结算净额映射，用于成员头像下方盈亏展示
      const totalsByOpenid = {}
      ;(res.settlement || []).forEach((s) => {
        totalsByOpenid[s.openid] = s.totalCents
      })
      const canTapMember = Boolean(permissions.canAddEntry) && room.status === 'active'
      this.setData({
        loading: false,
        error: null,
        room,
        members: (res.members || []).map((m) => ({
          ...m,
          isOwner: m.openid === room.ownerOpenid,
          ...toPlDisplay(totalsByOpenid[m.openid]),
          tappable: canTapMember && m.openid !== this.data.meOpenid
        })),
        settlement: res.settlement || [],
        entries: recent,
        entriesPage: 1,
        entriesHasMore: recent.length >= ENTRY_PAGE_SIZE,
        permissions,
        createdAtStr: formatDateTime(room.createdAt),
        endedReadonly: room.status === 'ended',
        inviteCode: room.inviteCode
      })
      if (room.status === 'active') {
        this.startPolling()
      } else {
        this.stopPolling()
      }
      if (this._pendingOpenInvite) {
        this._pendingOpenInvite = false
        this.openInvite()
      }
    } catch (err) {
      if (!silent) {
        this.setData({ loading: false, error: { code: err.code, message: friendlyMessage(err) } })
      }
    }
  },

  startPolling() {
    if (this._pollTimer) return
    this._pollTimer = setInterval(() => {
      this.loadDetail({ silent: true })
    }, POLL_INTERVAL_MS)
  },

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  },

  onPullDownRefresh() {
    this.loadDetail({ silent: false }).then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    this.loadMoreEntries()
  },

  async loadMoreEntries() {
    if (!this.data.entriesHasMore || this.data.loadingMore) return
    this.setData({ loadingMore: true })
    try {
      const res = await entryService.listEntries({
        roomId: this.data.roomId,
        page: this.data.entriesPage,
        pageSize: ENTRY_PAGE_SIZE
      })
      const items = res.items || []
      this.setData({
        entries: this.data.entries.concat(items),
        entriesPage: this.data.entriesPage + 1,
        entriesHasMore: Boolean(res.hasMore),
        loadingMore: false
      })
    } catch (err) {
      this.setData({ loadingMore: false })
      wx.showToast({ title: friendlyMessage(err), icon: 'none' })
    }
  },

  tapRetry() {
    this.loadDetail({ silent: false })
  },

  tapAddEntry() {
    wx.navigateTo({ url: `/pages/entry/entry?roomId=${this.data.roomId}` })
  },

  /**
   * 点击成员头像：快捷记一笔（付款人默认自己、收款人预置为该好友）。
   * 自己 / 已结束 / 无记账权限时不响应。
   */
  tapMember(e) {
    const openid = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.openid) || ''
    if (!openid || openid === this.data.meOpenid) return
    if (!this.data.permissions || !this.data.permissions.canAddEntry) return
    if (this.data.endedReadonly) return
    wx.navigateTo({ url: `/pages/entry/entry?roomId=${this.data.roomId}&payee=${openid}` })
  },

  // ---------------- 邀请 ----------------

  openInvite() {
    if (!this.data.permissions || !this.data.permissions.canInvite) return
    this.setData({ inviteVisible: true })
    if (!this.data.qrFileID && !this.data.qrLoading) {
      this.loadQr()
    }
  },

  tapInvite() {
    this.openInvite()
  },

  async loadQr() {
    this.setData({ qrLoading: true, qrError: '' })
    try {
      const res = await inviteService.getRoomQr(this.data.roomId)
      this.setData({
        qrLoading: false,
        qrFileID: res.fileID,
        inviteCode: res.inviteCode || this.data.inviteCode
      })
    } catch (err) {
      this.setData({ qrLoading: false, qrError: friendlyMessage(err) })
    }
  },

  onInviteClose() {
    this.setData({ inviteVisible: false })
  },

  onInviteRetry() {
    this.loadQr()
  },

  onCopyCode(e) {
    const code = (e.detail && e.detail.code) || this.data.inviteCode
    if (!code) return
    wx.setClipboardData({ data: code })
  },

  onShareAppMessage() {
    const room = this.data.room || {}
    return inviteService.getShareMessage({ name: room.name, inviteCode: room.inviteCode })
  },

  // ---------------- 结束牌局 ----------------

  tapEnd() {
    wx.showModal({
      title: '结束牌局',
      content: '结束后数据将变为只读，无法再新增流水或邀请新成员。确认结束？',
      confirmText: '确认结束',
      cancelText: '取消',
      success: (res) => {
        if (res && res.confirm) this.doEnd()
      }
    })
  },

  async doEnd() {
    if (this.data.submitting) return
    this.setData({ submitting: true })
    try {
      await roomService.endRoom(this.data.roomId)
      this.setData({ submitting: false })
      wx.showToast({ title: '牌局已结束', icon: 'success' })
      this.stopPolling()
      await this.loadDetail({ silent: false })
    } catch (err) {
      this.setData({ submitting: false })
      wx.showToast({ title: friendlyMessage(err), icon: 'none' })
    }
  },

  // ---------------- 删除牌局记录（仅房主） ----------------

  tapDelete() {
    if (!this.data.permissions || !this.data.permissions.canDeleteRoom) return
    wx.showModal({
      title: '删除牌局',
      content: '删除后该牌局及全部输赢流水将被清除，所有成员都不再看到，且无法恢复。确认删除？',
      confirmText: '确认删除',
      cancelText: '取消',
      success: (res) => {
        if (res && res.confirm) this.doDelete()
      }
    })
  },

  async doDelete() {
    if (this.data.submitting) return
    this.setData({ submitting: true })
    try {
      await roomService.deleteRoom(this.data.roomId)
      this.setData({ submitting: false })
      this.stopPolling()
      wx.showToast({ title: '已删除', icon: 'success' })
      wx.navigateBack()
    } catch (err) {
      this.setData({ submitting: false })
      // 已被房主之外并发删除：当作成功返回列表
      if (err && err.code === ErrorCodes.ROOM_NOT_FOUND) {
        this.stopPolling()
        wx.navigateBack()
        return
      }
      wx.showToast({ title: friendlyMessage(err), icon: 'none' })
    }
  }
})
