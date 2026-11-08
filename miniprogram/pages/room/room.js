/**
 * 牌局详情（详细设计 6.2.4 / 6.7 / 7.2-7.5）
 * 数据：roomService.getRoomDetail + entryService.listEntries 分页；
 * 进行中每 10 秒轮询（onHide/onUnload/已结束停止）；
 * 邀请：成员队尾的「＋」空头像框打开弹层（v1.8，原邀请按钮移除），打开弹层时才生成小程序码；结束：确认框 → endRoom → 只读；
 * 成员：头像下方显示当前盈亏；点好友头像弹出记账弹层（v1.7，记一笔页已移除），
 *       确认为「自己 → 该好友」的一笔支出，打开时生成 clientRequestId、失败重试复用；
 * 删除：房主可删除牌局记录（连同全部流水，需二次确认）。
 * v2.0：「结算统计」模块移除（净额仍在头像下方）；邀请码 4 位纯数字；成员上限 7 人。
 * v2.5：详情进内存缓存，进入页面先渲染缓存再后台校准（SWR）；记一笔/结束/删除成功后写时失效。
 * v2.6：长期未记账的牌局由服务端定时器自动结束——进行中且临近时点时顶部预告，已结束按 endReason 区分标注。
 */

const roomService = require('../../services/room-service')
const entryService = require('../../services/entry-service')
const inviteService = require('../../services/invite-service')
const { uuidv4 } = require('../../utils/uuid')
const { friendlyMessage } = require('../../utils/error-message')
const { formatDateTime } = require('../../utils/date')
const cache = require('../../utils/cache')
const { formatCents } = require('../../shared/money')
const { ErrorCodes } = require('../../shared/errors')
const { ROOM_POLL_INTERVAL_MS: POLL_INTERVAL_MS } = require('../../config/env')
const { DEFAULT_AVATAR_PATH } = require('../../config/assets')

const ENTRY_PAGE_SIZE = 20

/** v2.6：闲置自动结束的应用内预告窗口（纯展示口径；阈值以服务端 autoEndAt 为准，不在前端复制 7 天） */
const IDLE_PREWARN_WINDOW_MS = 2 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 闲置自动结束预告文案（v2.6）
 * @param {object} room detail 的房间对象（含 autoEndAt）
 * @param {number} nowMs 当前时间
 * @returns {string} 空串表示无需预告
 */
function idlePrewarnText(room, nowMs) {
  if (!room || room.status !== 'active') return ''
  const autoEndAt = room.autoEndAt
  if (!Number.isInteger(autoEndAt)) return '' // 服务端未下发则不猜
  const left = autoEndAt - nowMs
  if (left > IDLE_PREWARN_WINDOW_MS) return ''
  if (left <= 0) return '久未记账，本场牌局即将自动结束'
  const days = Math.max(1, Math.ceil(left / DAY_MS))
  return `久未记账，约 ${days} 天后将自动结束`
}

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
    room: null, // { roomId,name,inviteCode,ownerOpenid,status,memberCount,createdAt,endedAt,endReason,lastActivityAt,autoEndAt }
    members: [],
    entries: [],
    entriesPage: 1, // recentEntries 已覆盖第 0 页
    entriesHasMore: false,
    loadingMore: false,
    permissions: null, // { canAddEntry, canEndRoom, canInvite, canDeleteRoom }
    createdAtStr: '',
    endedReadonly: false,
    endedByIdle: false, // v2.6：已结束牌局是否为长期未记账自动结束
    idlePrewarnText: '', // v2.6：进行中牌局的自动结束预告文案（空则不显示）
    submitting: false,
    // 邀请弹层
    inviteVisible: false,
    inviteCode: '',
    qrFileID: '',
    qrLoading: false,
    qrError: '',
    // 记账弹层（v1.7：记一笔唯一入口）
    entryVisible: false,
    entryTarget: null, // { openid, nickname, avatarFileID }
    entrySubmitting: false,
    entryError: '' // 保存失败提示（弹层保留、重试复用幂等键）
  },

  _pollTimer: null,
  _pendingOpenInvite: false,
  _entryClientRequestId: '', // 打开弹层时生成；提交失败重试复用，成功后随关闭丢弃

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
   * 渲染一份详情响应（缓存命中的旧数据与服务端新数据走同一条路径）
   * @param {object} res room.detail 契约响应
   */
  applyDetail(res) {
    const room = res.room
    const recent = res.recentEntries || []
    const permissions = res.permissions || {}
    // 结算净额仅用于成员头像下方的盈亏展示（v2.0：「结算统计」模块已移除，res.settlement 不再单独入 data）
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
        avatarFileID: m.avatarFileID || DEFAULT_AVATAR_PATH, // v2.4：未上传头像兜底默认小人
        isOwner: m.openid === room.ownerOpenid,
        ...toPlDisplay(totalsByOpenid[m.openid]),
        tappable: canTapMember && m.openid !== this.data.meOpenid
      })),
      entries: recent,
      entriesPage: 1,
      entriesHasMore: recent.length >= ENTRY_PAGE_SIZE,
      permissions,
      createdAtStr: formatDateTime(room.createdAt),
      endedReadonly: room.status === 'ended',
      endedByIdle: room.status === 'ended' && room.endReason === 'idle', // v2.6：区分长期未记账自动结束
      idlePrewarnText: idlePrewarnText(room, Date.now()), // v2.6：进行中牌局的自动结束预告
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
  },

  /**
   * 拉取详情（静默失败时保留旧数据）
   * v2.5：非静默进入时先渲染缓存再后台校准；校准/刷新失败且已有缓存渲染则保留内容不弹错误页。
   * @param {{silent?: boolean}} [opts]
   */
  async loadDetail({ silent = false } = {}) {
    const key = cache.keys.roomDetail(this.data.roomId)
    if (!silent) {
      const cached = cache.get(key)
      if (cached && cached.room) {
        this.applyDetail(cached) // SWR 首屏：秒开，随后照常拉取校准
      } else {
        this.setData({ loading: true, error: null })
      }
    }
    try {
      const res = await roomService.getRoomDetail(this.data.roomId)
      cache.set(key, res)
      this.applyDetail(res)
    } catch (err) {
      if (!silent && !this.data.room) {
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

  // v2.3：页面整页不滚，流水分页由滚动区触底驱动；onReachBottom 保留兜底（正常不触发）
  onEntriesReachBottom() {
    this.loadMoreEntries()
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

  // ---------------- 记账弹层（v1.7：点头像记一笔） ----------------

  /**
   * 点击成员头像：打开「向该好友支出」弹层。
   * 自己 / 已结束 / 无记账权限 / 弹层已打开时不响应。
   */
  tapMember(e) {
    if (this.data.entryVisible) return
    const openid = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.openid) || ''
    if (!openid || openid === this.data.meOpenid) return
    if (!this.data.permissions || !this.data.permissions.canAddEntry) return
    if (this.data.endedReadonly) return
    const target = this.data.members.find((m) => m.openid === openid)
    if (!target) return
    this._entryClientRequestId = uuidv4()
    this.setData({
      entryVisible: true,
      entryTarget: {
        openid,
        nickname: target.nickname || '好友',
        avatarFileID: target.avatarFileID || DEFAULT_AVATAR_PATH
      },
      entrySubmitting: false,
      entryError: ''
    })
  },

  onEntryClose() {
    if (this.data.entrySubmitting) return // 提交中禁止关闭，避免结果无处安放
    this.setData({ entryVisible: false, entryTarget: null, entryError: '' })
  },

  /**
   * 弹层确认：记「自己 → 该好友」的一笔支出。
   * 成功：关闭 + Toast + 静默刷新盈亏与流水；
   * 可失败：保留弹层与输入，重试复用同一幂等键；
   * 致命失败（已结束/非成员）：关闭并刷新为最新状态（通常转只读）。
   */
  async onEntryConfirm(e) {
    const valueCents = (e && e.detail && e.detail.valueCents) || 0
    const target = this.data.entryTarget || {}
    if (!target.openid || valueCents <= 0 || this.data.entrySubmitting) return
    this.setData({ entrySubmitting: true, entryError: '' })
    try {
      await entryService.addEntry({
        roomId: this.data.roomId,
        fromOpenid: this.data.meOpenid,
        toOpenid: target.openid,
        amountCents: valueCents,
        clientRequestId: this._entryClientRequestId
      })
      this.setData({ entrySubmitting: false, entryVisible: false, entryTarget: null, entryError: '' })
      wx.showToast({ title: '已记录', icon: 'success' })
      cache.remove(cache.keys.roomDetail(this.data.roomId)) // 写时失效：若随后的静默刷新失败，下次进入不渲染缺这笔流水的旧详情
      this.loadDetail({ silent: true }) // 立即刷新头像盈亏与流水列表（维持全量刷新，不做乐观追加）
    } catch (err) {
      const fatal = err && (err.code === ErrorCodes.ROOM_ENDED || err.code === ErrorCodes.NOT_ROOM_MEMBER)
      if (fatal) {
        this.setData({ entrySubmitting: false, entryVisible: false, entryTarget: null, entryError: '' })
        wx.showToast({ title: friendlyMessage(err), icon: 'none' })
        cache.remove(cache.keys.roomDetail(this.data.roomId)) // 状态已变，清掉旧详情缓存再刷新
        this.loadDetail({ silent: false }) // 状态已变（如刚被结束），刷新为最新
        return
      }
      // 幂等键保持不变：重开弹层才会重新生成
      this.setData({ entrySubmitting: false, entryError: friendlyMessage(err) })
    }
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

  /**
   * 复制邀请码：事件对象可能缺省（页面卸载后组件仍有引用时派发），
   * 故给默认值，避免读 e.detail 抛错；无 code 时兜底页面上的邀请码。
   */
  onCopyCode(e = {}) {
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
      cache.remove(cache.keys.roomDetail(this.data.roomId)) // 写时失效：状态已变（只读），旧详情不应再被首屏渲染
      cache.remove(cache.keys.roomsList())
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
      cache.remove(cache.keys.roomDetail(this.data.roomId)) // 写时失效：牌局已不存在，任何缓存条目都不能再渲染
      cache.remove(cache.keys.roomsList())
      wx.showToast({ title: '已删除', icon: 'success' })
      wx.navigateBack()
    } catch (err) {
      this.setData({ submitting: false })
      // 已被房主之外并发删除：当作成功返回列表
      if (err && err.code === ErrorCodes.ROOM_NOT_FOUND) {
        this.stopPolling()
        cache.remove(cache.keys.roomDetail(this.data.roomId))
        cache.remove(cache.keys.roomsList())
        wx.navigateBack()
        return
      }
      wx.showToast({ title: friendlyMessage(err), icon: 'none' })
    }
  }
})
