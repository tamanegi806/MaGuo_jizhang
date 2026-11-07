/**
 * 创建牌局页测试 — 校验、幂等键生成与复用、跳转
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

const opts = loadPageOptions('../../miniprogram/pages/create/create')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let wx

beforeEach(() => {
  jest.clearAllMocks()
  wx = createWxMock()
  global.wx = wx
  mockGetApp({ user: { openid: 'o_me', profileComplete: true }, needProfile: false })
})

describe('pages/create', () => {
  test('空名称 -> 提示且不请求', async () => {
    const inst = createInstance(opts)
    await inst.onSubmit()
    expect(inst.data.nameError).toBe('请输入牌局名称')
    expect(roomService.createRoom).not.toHaveBeenCalled()
  })

  test('超过 30 字 -> 提示且不请求', async () => {
    const inst = createInstance(opts)
    inst.onInputName({ detail: { value: '名'.repeat(31) } })
    await inst.onSubmit()
    expect(inst.data.nameError).toContain('30')
    expect(roomService.createRoom).not.toHaveBeenCalled()
  })

  test('成功：首次生成 clientRequestId（UUID），跳转详情并带 openInvite=1', async () => {
    roomService.createRoom.mockResolvedValue({ room: { roomId: 'r_new' } })
    const inst = createInstance(opts)
    inst.onInputName({ detail: { value: '周五夜场' } })
    await inst.onSubmit()
    expect(roomService.createRoom).toHaveBeenCalledWith({ name: '周五夜场', clientRequestId: expect.stringMatching(UUID_RE) })
    expect(inst.data.clientRequestId).toMatch(UUID_RE)
    expect(wx.redirectTo).toHaveBeenCalledWith({ url: '/pages/room/room?id=r_new&openInvite=1' })
  })

  test('失败：保留输入与幂等键，重试复用同一个 clientRequestId', async () => {
    roomService.createRoom.mockRejectedValue({ code: 'NETWORK_ERROR' })
    const inst = createInstance(opts)
    inst.onInputName({ detail: { value: '周五夜场' } })
    await inst.onSubmit()
    expect(inst.data.submitting).toBe(false)
    expect(inst.data.error).toEqual({ code: 'NETWORK_ERROR', message: '网络异常，请检查连接' })
    expect(inst.data.name).toBe('周五夜场')
    const key = inst.data.clientRequestId

    roomService.createRoom.mockResolvedValue({ room: { roomId: 'r_new' } })
    await inst.onSubmit()
    expect(roomService.createRoom).toHaveBeenLastCalledWith({ name: '周五夜场', clientRequestId: key })
    expect(wx.redirectTo).toHaveBeenCalled()
  })

  test('提交中重复点击被忽略（按钮禁用时 onSubmit 直调也安全）', async () => {
    let resolveFirst
    roomService.createRoom.mockImplementation(
      () => new Promise((r) => { resolveFirst = r })
    )
    const inst = createInstance(opts)
    inst.onInputName({ detail: { value: '夜场' } })
    const p = inst.onSubmit()
    expect(inst.data.submitting).toBe(true)
    await inst.onSubmit() // 第二次直调应被忽略
    expect(roomService.createRoom).toHaveBeenCalledTimes(1)
    resolveFirst({ room: { roomId: 'r_x' } })
    await p
  })

  test('新页面实例幂等键不复用（独立进入）', async () => {
    roomService.createRoom.mockResolvedValue({ room: { roomId: 'r_a' } })
    const a = createInstance(opts)
    a.onInputName({ detail: { value: 'A' } })
    await a.onSubmit()
    const b = createInstance(opts)
    b.onInputName({ detail: { value: 'B' } })
    await b.onSubmit()
    expect(a.data.clientRequestId).not.toBe(b.data.clientRequestId)
  })
})
