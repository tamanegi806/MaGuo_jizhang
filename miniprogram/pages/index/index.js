/**
 * 首页 — 我的牌局列表 + 创建/加入入口 + 资料入口（详细设计 6.2.1）
 * 所有数据经 services；页面不直接调用 wx.cloud。
 * v2.5：第 0 页列表进内存缓存，onShow 命中缓存先渲染再后台静默校准（SWR）。
 */

const roomService = require('../../services/room-service')
const { friendlyMessage } = require('../../utils/error-message')
const { formatDateTime } = require('../../utils/date')
const { uuidv4 } = require('../../utils/uuid')
const cache = require('../../utils/cache')
const { DEFAULT_AVATAR_PATH } = require('../../config/assets')

const PAGE_SIZE = 20

function toCard(room) {
  return {
    roomId: room.roomId,
    memberCount: room.memberCount,
    status: room.status,
    statusText: room.status === 'ended' ? '已结束' : '进行中',
    createdAtStr: formatDateTime(room.createdAt)
  }
}

Page({
  data: {
    loading: true,
    error: null, // { code, message }
    rooms: [],
    page: 0, // 下一页页码
    hasMore: true,
    loadingMore: false,
    creating: false,
    clientRequestId: '', // 创建幂等键：失败重试复用，成功后清空待下次新建
    user: null
  },

  onShow() {
    const app = getApp()
    // 资料未完善时引导去资料页（onShow 跳转最可靠）
    if (app.globalData.user && app.globalData.needProfile) {
      wx.navigateTo({ url: '/pages/profile/profile' })
      return
    }
    const u = app.globalData.user
    this.setData({ user: u ? { ...u, avatarFileID: u.avatarFileID || DEFAULT_AVATAR_PATH } : null })
    // v2.5 SWR：命中缓存先渲染第 0 页（不出骨架），随后照常后台校准
    const cached = cache.get(cache.keys.roomsList())
    if (cached && Array.isArray(cached.items)) {
      this.setData({
        rooms: cached.items.map(toCard),
        page: 1,
        hasMore: Boolean(cached.hasMore),
        loading: false
      })
      this.loadRooms({ refresh: true, background: true })
      return
    }
    this.loadRooms({ refresh: true })
  },

  /**
   * 加载牌局列表
   * @param {{refresh?: boolean, background?: boolean}} [opts]
   *   refresh=重新加载第 0 页；background=已有缓存渲染时不置 loading、失败不弹错误页
   */
  async loadRooms({ refresh = false, background = false } = {}) {
    if (refresh && !background) {
      this.setData({ loading: true, error: null })
    }
    const page = refresh ? 0 : this.data.page
    try {
      const res = await roomService.listRooms({ page, pageSize: PAGE_SIZE })
      if (page === 0) cache.set(cache.keys.roomsList(), res) // 只缓存第 0 页（首屏渲染源）
      const items = (res.items || []).map(toCard)
      const rooms = refresh ? items : this.data.rooms.concat(items)
      this.setData({
        rooms,
        page: page + 1,
        hasMore: Boolean(res.hasMore),
        loading: false,
        loadingMore: false,
        error: null
      })
    } catch (err) {
      const error = { code: err.code, message: friendlyMessage(err) }
      // 已有列表 / 后台校准时仅轻提示，不打断已渲染内容
      if (!refresh || background || this.data.rooms.length > 0) {
        this.setData({ loading: false, loadingMore: false })
        wx.showToast({ title: error.message, icon: 'none' })
      } else {
        this.setData({ loading: false, loadingMore: false, error })
      }
    }
  },

  onPullDownRefresh() {
    this.loadRooms({ refresh: true }).then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.loading) return
    this.setData({ loadingMore: true })
    this.loadRooms({ refresh: false })
  },

  tapRetry() {
    this.loadRooms({ refresh: true })
  },

  /**
   * 直接创建牌局（v1.4 起无名称输入）：成功跳详情并自动打开邀请。
   * 幂等键首次生成、失败重试复用；创建成功后清空，下一次点击是新牌局。
   */
  async tapCreate() {
    if (this.data.creating) return
    const clientRequestId = this.data.clientRequestId || uuidv4()
    if (clientRequestId !== this.data.clientRequestId) {
      this.setData({ clientRequestId })
    }
    this.setData({ creating: true })
    try {
      const res = await roomService.createRoom({ clientRequestId })
      this.setData({ creating: false, clientRequestId: '' })
      cache.remove(cache.keys.roomsList()) // 写时失效：新牌局不在旧列表里，别让下次 onShow 渲染脏数据
      const roomId = res && res.room ? res.room.roomId : ''
      wx.navigateTo({ url: `/pages/room/room?id=${roomId}&openInvite=1` })
    } catch (err) {
      this.setData({ creating: false })
      wx.showToast({ title: friendlyMessage(err), icon: 'none' })
    }
  },

  tapJoin() {
    wx.navigateTo({ url: '/pages/join/join' })
  },

  tapProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  }
})
