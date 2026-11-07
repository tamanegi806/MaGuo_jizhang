/**
 * 首页 — 我的牌局列表 + 创建/加入入口 + 资料入口（详细设计 6.2.1）
 * 所有数据经 services；页面不直接调用 wx.cloud。
 */

const roomService = require('../../services/room-service')
const { friendlyMessage } = require('../../utils/error-message')
const { formatDateTime } = require('../../utils/date')

const PAGE_SIZE = 20

function toCard(room) {
  return {
    roomId: room.roomId,
    name: room.name,
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
    user: null
  },

  onShow() {
    const app = getApp()
    // 资料未完善时引导去资料页（onShow 跳转最可靠）
    if (app.globalData.user && app.globalData.needProfile) {
      wx.navigateTo({ url: '/pages/profile/profile' })
      return
    }
    this.setData({ user: app.globalData.user })
    this.loadRooms({ refresh: true })
  },

  /**
   * 加载牌局列表
   * @param {{refresh?: boolean}} [opts] refresh=重新加载第 0 页
   */
  async loadRooms({ refresh = false } = {}) {
    if (refresh) {
      this.setData({ loading: true, error: null })
    }
    const page = refresh ? 0 : this.data.page
    try {
      const res = await roomService.listRooms({ page, pageSize: PAGE_SIZE })
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
      // 已有列表时仅轻提示，不打断浏览
      if (!refresh || this.data.rooms.length > 0) {
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

  tapCreate() {
    wx.navigateTo({ url: '/pages/create/create' })
  },

  tapJoin() {
    wx.navigateTo({ url: '/pages/join/join' })
  },

  tapProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  }
})
