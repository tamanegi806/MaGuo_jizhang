/**
 * 牌局详情（详细设计 6.2.4 / 6.7 / 7.2-7.5）
 * 数据：roomService.getRoomDetail + entryService.listEntries 分页；
 * 进行中每 10 秒轮询（onHide/onUnload/已结束停止）；
 * 邀请：打开弹层时才生成小程序码；结束：确认框 → endRoom → 只读。
 */

const roomService = require('../../services/room-service')
const entryService = require('../../services/entry-service')
const inviteService = require('../../services/invite-service')
const { friendlyMessage } = require('../../utils/error-message')
const { formatDateTime } = require('../../utils/date')
const { ROOM_POLL_INTERVAL_MS: POLL_INTERVAL_MS } = require('../../config/env')

const ENTRY_PAGE_SIZE = 20

Page({
  data: {
    roomId: '',
    loading: true,
    error: null, // { code, message }
    room: null, // { roomId,name,inviteCode,ownerOpenid,status,memberCount,createdAt,endedAt }
    members: [],
    settlement: [],
    entries: [],
    entriesPage: 1, // recentEntries 已覆盖第 0 页
    entriesHasMore: false,
    loadingMore: false,
    permissions: null, // { canAddEntry, canEndRoom, canInvite }
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
    this.setData({ roomId })
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
      this.setData({
        loading: false,
        error: null,
        room,
        members: (res.members || []).map((m) => ({
          ...m,
          isOwner: m.openid === room.ownerOpenid
        })),
        settlement: res.settlement || [],
        entries: recent,
        entriesPage: 1,
        entriesHasMore: recent.length >= ENTRY_PAGE_SIZE,
        permissions: res.permissions || {},
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
  }
})
