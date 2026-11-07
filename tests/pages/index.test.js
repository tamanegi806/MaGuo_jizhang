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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

  test('onShow 加载第 0 页并映射展示字段（v1.4 卡片不再显示名称）', async () => {
    roomService.listRooms.mockResolvedValue({ items: [roomSummary()], page: 0, hasMore: false })
    const inst = await shown(createInstance(opts))
    expect(roomService.listRooms).toHaveBeenCalledWith({ page: 0, pageSize: 20 })
    expect(inst.data.rooms[0]).toMatchObject({
      roomId: 'r_1',
      statusText: '进行中',
      createdAtStr: '2026-11-07 20:00',
      memberCount: 4
    })
    expect(inst.data.rooms[0]).not.toHaveProperty('name')
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

  test('入口跳转（join/profile）', () => {
    const inst = createInstance(opts)
    inst.tapJoin()
    inst.tapProfile()
    expect(wx.navigateTo.mock.calls).toEqual([
      [{ url: '/pages/join/join' }],
      [{ url: '/pages/profile/profile' }]
    ])
  })

  test('tapCreate 直接创建（不传名称）-> 跳详情并自动打开邀请', async () => {
    roomService.createRoom.mockResolvedValue({ room: { roomId: 'r_new' } })
    const inst = createInstance(opts)
    await inst.tapCreate()
    expect(roomService.createRoom).toHaveBeenCalledWith({
      clientRequestId: expect.stringMatching(UUID_RE)
    })
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/room/room?id=r_new&openInvite=1' })
    expect(inst.data.creating).toBe(false)
    expect(inst.data.clientRequestId).toBe('') // 成功后清键，下次点击是新牌局
  })

  test('创建失败 -> Toast 且保留幂等键；重试复用同键', async () => {
    roomService.createRoom.mockRejectedValue({ code: 5001, message: 'INTERNAL_ERROR' })
    const inst = createInstance(opts)
    await inst.tapCreate()
    expect(wx.showToast).toHaveBeenCalledWith({ title: '服务异常，请稍后再试', icon: 'none' })
    const key = inst.data.clientRequestId
    expect(key).toMatch(UUID_RE)

    roomService.createRoom.mockResolvedValue({ room: { roomId: 'r_new' } })
    await inst.tapCreate()
    expect(roomService.createRoom).toHaveBeenLastCalledWith({ clientRequestId: key })
    expect(inst.data.clientRequestId).toBe('')
  })

  test('创建进行中重复点击不再发请求', async () => {
    let resolve
    roomService.createRoom.mockImplementation(
      () => new Promise((r) => { resolve = r })
    )
    const inst = createInstance(opts)
    const first = inst.tapCreate()
    await inst.tapCreate() // 第二次点击应被 creating 拦截
    expect(roomService.createRoom).toHaveBeenCalledTimes(1)
    resolve({ room: { roomId: 'r_new' } })
    await first
    expect(wx.navigateTo).toHaveBeenCalledTimes(1)
  })
})
