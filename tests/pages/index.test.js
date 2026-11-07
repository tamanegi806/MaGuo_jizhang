/**
 * 首页逻辑测试 — 列表加载/分页/下拉刷新/错误态/资料引导
 */

jest.mock('../../miniprogram/services/room-service', () => ({
  listRooms: jest.fn(),
  createRoom: jest.fn(),
  joinRoom: jest.fn(),
  getRoomDetail: jest.fn(),
  endRoom: jest.fn()
}))

const roomService = require('../../miniprogram/services/room-service')
const {
  loadPageOptions,
  createInstance,
  createWxMock,
  flushPromises,
  mockGetApp
} = require('../helpers/page-harness')

const opts = loadPageOptions('../../miniprogram/pages/index/index')

const TS = new Date(2026, 10, 7, 20, 0).getTime()

function roomSummary(over = {}) {
  return {
    roomId: 'r_1',
    name: '周五夜场',
    inviteCode: 'A7K2M9',
    status: 'active',
    memberCount: 4,
    createdAt: TS,
    endedAt: null,
    ...over
  }
}

let wx
let globalData

beforeEach(() => {
  jest.clearAllMocks()
  wx = createWxMock()
  global.wx = wx
  globalData = mockGetApp({ user: { openid: 'o_me', nickname: '我', profileComplete: true }, needProfile: false })
})

async function shown(inst) {
  inst.onShow()
  await flushPromises()
  return inst
}

describe('pages/index', () => {
  test('onShow 资料未完善 -> 跳资料页且不发列表请求', async () => {
    globalData.needProfile = true
    const inst = createInstance(opts)
    inst.onShow()
    await flushPromises()
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/profile/profile' })
    expect(roomService.listRooms).not.toHaveBeenCalled()
  })

  test('onShow 加载第 0 页并映射展示字段', async () => {
    roomService.listRooms.mockResolvedValue({ items: [roomSummary()], page: 0, hasMore: false })
    const inst = await shown(createInstance(opts))
    expect(roomService.listRooms).toHaveBeenCalledWith({ page: 0, pageSize: 20 })
    expect(inst.data.rooms[0]).toMatchObject({
      roomId: 'r_1',
      name: '周五夜场',
      statusText: '进行中',
      createdAtStr: '2026-11-07 20:00',
      memberCount: 4
    })
    expect(inst.data.loading).toBe(false)
    expect(inst.data.hasMore).toBe(false)
  })

  test('已结束牌局显示「已结束」', async () => {
    roomService.listRooms.mockResolvedValue({ items: [roomSummary({ status: 'ended' })], hasMore: false })
    const inst = await shown(createInstance(opts))
    expect(inst.data.rooms[0].statusText).toBe('已结束')
  })

  test('加载失败（空列表）-> error 状态友好文案', async () => {
    roomService.listRooms.mockRejectedValue({ code: 5001, message: 'INTERNAL_ERROR' })
    const inst = await shown(createInstance(opts))
    expect(inst.data.error).toEqual({ code: 5001, message: '服务异常，请稍后再试' })
    expect(inst.data.loading).toBe(false)
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test('已有列表时刷新失败 -> 仅 Toast 不打断', async () => {
    roomService.listRooms.mockResolvedValueOnce({ items: [roomSummary()], hasMore: true })
    const inst = await shown(createInstance(opts))
    roomService.listRooms.mockRejectedValueOnce({ code: 'NETWORK_ERROR' })
    await inst.loadRooms({ refresh: true })
    expect(inst.data.rooms).toHaveLength(1)
    expect(inst.data.error).toBeNull()
    expect(wx.showToast).toHaveBeenCalledWith({ title: '网络异常，请检查连接', icon: 'none' })
  })

  test('触底加载下一页并追加；无更多后不再请求', async () => {
    roomService.listRooms.mockResolvedValueOnce({ items: [roomSummary()], hasMore: true })
    const inst = await shown(createInstance(opts))
    roomService.listRooms.mockResolvedValueOnce({
      items: [roomSummary({ roomId: 'r_2', name: '第二局' })],
      hasMore: false
    })
    inst.onReachBottom()
    await flushPromises()
    expect(roomService.listRooms).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 })
    expect(inst.data.rooms.map((r) => r.roomId)).toEqual(['r_1', 'r_2'])
    expect(inst.data.hasMore).toBe(false)

    inst.onReachBottom()
    await flushPromises()
    expect(roomService.listRooms).toHaveBeenCalledTimes(2)
  })

  test('下拉刷新重新加载第 0 页并停止下拉', async () => {
    roomService.listRooms.mockResolvedValue({ items: [], hasMore: false })
    const inst = await shown(createInstance(opts))
    inst.onPullDownRefresh()
    await flushPromises()
    expect(roomService.listRooms).toHaveBeenCalledTimes(2)
    expect(roomService.listRooms).toHaveBeenLastCalledWith({ page: 0, pageSize: 20 })
    expect(wx.stopPullDownRefresh).toHaveBeenCalled()
  })

  test('重试按钮 -> 重新加载', async () => {
    roomService.listRooms.mockRejectedValue({ code: 5001 })
    const inst = await shown(createInstance(opts))
    roomService.listRooms.mockResolvedValue({ items: [roomSummary()], hasMore: false })
    inst.tapRetry()
    await flushPromises()
    expect(inst.data.error).toBeNull()
    expect(inst.data.rooms).toHaveLength(1)
  })

  test('入口跳转', () => {
    const inst = createInstance(opts)
    inst.tapCreate()
    inst.tapJoin()
    inst.tapProfile()
    expect(wx.navigateTo.mock.calls).toEqual([
      [{ url: '/pages/create/create' }],
      [{ url: '/pages/join/join' }],
      [{ url: '/pages/profile/profile' }]
    ])
  })
})
