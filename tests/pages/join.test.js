/**
 * 加入牌局页测试 — code/scene 自动加入、失败保留输入、格式校验
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
const {
  loadPageOptions,
  createInstance,
  createWxMock,
  flushPromises,
  mockGetApp
} = require('../helpers/page-harness')

const opts = loadPageOptions('../../miniprogram/pages/join/join')

let wx

beforeEach(() => {
  jest.clearAllMocks()
  cache.clearAll() // v2.5 内存缓存为模块级状态，用例间须隔离
  wx = createWxMock()
  global.wx = wx
  mockGetApp({ user: { openid: 'o_me', profileComplete: true } })
})

describe('pages/join', () => {
  test('onLoad options.code -> 自动加入并 redirectTo 详情', async () => {
    roomService.joinRoom.mockResolvedValue({ room: { roomId: 'r_9' }, alreadyMember: false })
    const inst = createInstance(opts)
    inst.onLoad({ code: ' 8234 ' })
    expect(inst.data.autoJoining).toBe(true)
    expect(roomService.joinRoom).toHaveBeenCalledWith('8234')
    await flushPromises()
    expect(wx.redirectTo).toHaveBeenCalledWith({ url: '/pages/room/room?id=r_9' })
    expect(inst.data.autoJoining).toBe(false)
  })

  test('onLoad options.scene（URL 编码）-> 解析 c=XXXXXX 自动加入', async () => {
    roomService.joinRoom.mockResolvedValue({ room: { roomId: 'r_8' }, alreadyMember: false })
    const inst = createInstance(opts)
    inst.onLoad({ scene: 'c%3D8234' })
    await flushPromises()
    expect(roomService.joinRoom).toHaveBeenCalledWith('8234')
    expect(wx.redirectTo).toHaveBeenCalled()
  })

  test('无参数进入 -> 手动输入态', async () => {
    const inst = createInstance(opts)
    inst.onLoad({})
    await flushPromises()
    expect(roomService.joinRoom).not.toHaveBeenCalled()
    expect(inst.data.autoJoining).toBe(false)
  })

  test('自动加入失败 -> 保留错误并回到手动输入', async () => {
    roomService.joinRoom.mockRejectedValue({ code: 2007, message: 'INVALID_INVITE_CODE' })
    const inst = createInstance(opts)
    inst.onLoad({ code: '0000' })
    await flushPromises()
    expect(inst.data.error).toEqual({ code: 2007, message: '邀请码无效，请向好友确认' })
    expect(inst.data.autoJoining).toBe(false)
    expect(inst.data.code).toBe('0000')
    expect(wx.redirectTo).not.toHaveBeenCalled()
  })

  test('已结束牌局 -> 提示且无跳转', async () => {
    roomService.joinRoom.mockRejectedValue({ code: 2002, message: 'ROOM_ENDED' })
    const inst = createInstance(opts)
    inst.onLoad({ code: '8234' })
    await flushPromises()
    expect(inst.data.error.message).toContain('牌局已结束')
  })

  test('已是成员（alreadyMember）-> 直接进入详情', async () => {
    roomService.joinRoom.mockResolvedValue({ room: { roomId: 'r_7' }, alreadyMember: true })
    const inst = createInstance(opts)
    inst.onLoad({ code: '8234' })
    await flushPromises()
    expect(wx.redirectTo).toHaveBeenCalledWith({ url: '/pages/room/room?id=r_7' })
  })

  test('手动：空码与非法格式 -> 本地校验不发请求', async () => {
    const inst = createInstance(opts)
    await inst.tapJoin()
    expect(inst.data.error.message).toBe('请输入 4 位邀请码')

    inst.onInputCode({ detail: { value: 'abc' } })
    await inst.tapJoin()
    expect(inst.data.error.message).toBe('邀请码应为 4 位数字')
    expect(roomService.joinRoom).not.toHaveBeenCalled()
  })

  test('手动：首尾空格规范化后加入成功', async () => {
    roomService.joinRoom.mockResolvedValue({ room: { roomId: 'r_6' }, alreadyMember: false })
    const inst = createInstance(opts)
    inst.onInputCode({ detail: { value: ' 8234 ' } })
    await inst.tapJoin()
    expect(roomService.joinRoom).toHaveBeenCalledWith('8234')
    expect(wx.redirectTo).toHaveBeenCalled()
  })

  test('满员 -> 友好提示保留输入', async () => {
    roomService.joinRoom.mockRejectedValue({ code: 2005, message: 'ROOM_FULL' })
    const inst = createInstance(opts)
    inst.onInputCode({ detail: { value: '8234' } })
    await inst.tapJoin()
    expect(inst.data.error.message).toMatch(/人数已满/)
    expect(inst.data.code).toBe('8234')
  })

  test('v2.5 加入成功 -> 首页列表缓存写时失效', async () => {
    cache.set(cache.keys.roomsList(), { items: [] })
    roomService.joinRoom.mockResolvedValue({ room: { roomId: 'r_7' }, alreadyMember: false })
    const inst = createInstance(opts)
    await inst.doJoin('8234')
    expect(cache.get(cache.keys.roomsList())).toBeUndefined()
  })
})
