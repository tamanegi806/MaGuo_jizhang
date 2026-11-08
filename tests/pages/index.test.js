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
const cache = require('../../miniprogram/utils/cache')
const privacy = require('../../miniprogram/utils/privacy')
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
    inviteCode: '8234',
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
  cache.clearAll() // v2.5 内存缓存为模块级状态，用例间须隔离
  privacy.resetSession() // v2.7 隐私授权会话状态同为模块级，须一并隔离
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

  test('v2.4 onShow 顶部用户空 avatarFileID -> 兜底默认小人路径', async () => {
    globalData.user.avatarFileID = ''
    roomService.listRooms.mockResolvedValue({ items: [], page: 0, hasMore: false })
    const inst = await shown(createInstance(opts))
    expect(inst.data.user.avatarFileID).toBe('/images/default-avatar.png')
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

  describe('v2.5 内存缓存 SWR', () => {
    test('二次 onShow：先同步渲染缓存第 0 页（不出骨架），随后后台校准覆盖', async () => {
      roomService.listRooms.mockResolvedValue({ items: [roomSummary()], hasMore: true })
      await shown(createInstance(opts)) // 第一次进入：写入缓存

      roomService.listRooms.mockResolvedValue({ items: [roomSummary({ roomId: 'r_2' })], hasMore: false })
      const inst2 = createInstance(opts)
      inst2.onShow()
      // 同步部分即已渲染旧数据，且未经过 loading 骨架
      expect(inst2.data.rooms.map((r) => r.roomId)).toEqual(['r_1'])
      expect(inst2.data.loading).toBe(false)
      expect(roomService.listRooms).toHaveBeenCalledTimes(2) // 后台校准请求已发出

      await flushPromises()
      expect(inst2.data.rooms.map((r) => r.roomId)).toEqual(['r_2'])
      expect(inst2.data.hasMore).toBe(false)
    })

    test('后台校准失败 -> 保留已渲染列表，仅 Toast 不进错误页', async () => {
      roomService.listRooms.mockResolvedValue({ items: [roomSummary()], hasMore: false })
      await shown(createInstance(opts))

      roomService.listRooms.mockRejectedValue({ code: 'NETWORK_ERROR' })
      const inst2 = createInstance(opts)
      await shown(inst2)
      expect(inst2.data.rooms.map((r) => r.roomId)).toEqual(['r_1'])
      expect(inst2.data.error).toBeNull()
      expect(wx.showToast).toHaveBeenCalledWith({ title: '网络异常，请检查连接', icon: 'none' })
    })

    test('创建成功 -> 列表缓存写时失效', async () => {
      roomService.listRooms.mockResolvedValue({ items: [roomSummary()], hasMore: false })
      await shown(createInstance(opts))
      expect(cache.get(cache.keys.roomsList())).toBeDefined()

      roomService.createRoom.mockResolvedValue({ room: { roomId: 'r_new' } })
      await createInstance(opts).tapCreate()
      expect(cache.get(cache.keys.roomsList())).toBeUndefined()
    })

    test('无缓存首次进入 -> 仍走 loading 骨架后填充', async () => {
      roomService.listRooms.mockResolvedValue({ items: [roomSummary()], hasMore: false })
      const inst = createInstance(opts)
      inst.onShow()
      expect(inst.data.loading).toBe(true) // 未命中缓存：保持旧行为
      await flushPromises()
      expect(inst.data.loading).toBe(false)
    })
  })

  describe('v2.7 隐私授权前置', () => {
    test('首次 onShow 即触发授权弹窗，且不推迟列表请求', async () => {
      wx.requirePrivacyAuthorize = jest.fn(({ success }) => success())
      roomService.listRooms.mockResolvedValue({ items: [roomSummary()], hasMore: false })
      const inst = createInstance(opts)
      inst.onShow()
      // 同步即已发出列表请求：弹窗不该挡首屏
      expect(roomService.listRooms).toHaveBeenCalledTimes(1)
      expect(wx.requirePrivacyAuthorize).toHaveBeenCalledTimes(1)
      await flushPromises()
      expect(inst.data.rooms).toHaveLength(1)
    })

    test('会话内二次 onShow 不再重复打扰', async () => {
      wx.requirePrivacyAuthorize = jest.fn(({ success }) => success())
      roomService.listRooms.mockResolvedValue({ items: [], hasMore: false })
      const inst = createInstance(opts)
      inst.onShow()
      await flushPromises()
      inst.onShow()
      await flushPromises()
      expect(wx.requirePrivacyAuthorize).toHaveBeenCalledTimes(1)
    })

    test('拒绝授权不锁死功能：列表照常渲染、不进错误页', async () => {
      wx.requirePrivacyAuthorize = jest.fn(({ fail }) => fail(new Error('deny')))
      roomService.listRooms.mockResolvedValue({ items: [roomSummary()], hasMore: false })
      const inst = createInstance(opts)
      await shown(inst)
      expect(inst.data.rooms).toHaveLength(1)
      expect(inst.data.error).toBeNull()
      // 不在首页留任何全局状态：拒绝的后果只在采集出口（资料页）就地解释
      expect(globalData.privacyDenied).toBeUndefined()
    })

    test('资料未完善时仍先跳资料页（跳转与授权弹窗并发，不相互等待）', async () => {
      const hooks = {}
      wx.requirePrivacyAuthorize = jest.fn((opts2) => { hooks.s = opts2.success })
      globalData.needProfile = true
      const inst = createInstance(opts)
      inst.onShow()
      expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/profile/profile' })
      expect(roomService.listRooms).not.toHaveBeenCalled()
      hooks.s && hooks.s() // 收尾未决弹窗，避免 pending 泄漏到下一用例
    })
  })
})
