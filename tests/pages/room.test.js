/**
 * 牌局详情页测试 — 加载/轮询/分页/邀请/结束/只读
 * 用注入的 setInterval/clearInterval 捕获轮询，避免假定时器干扰 promise 冲刷。
 */

jest.mock('../../miniprogram/services/room-service', () => ({
  listRooms: jest.fn(),
  createRoom: jest.fn(),
  joinRoom: jest.fn(),
  getRoomDetail: jest.fn(),
  endRoom: jest.fn(),
  deleteRoom: jest.fn()
}))
jest.mock('../../miniprogram/services/entry-service', () => ({
  addEntry: jest.fn(),
  listEntries: jest.fn()
}))
jest.mock('../../miniprogram/services/invite-service', () => {
  const actual = jest.requireActual('../../miniprogram/services/invite-service')
  return { ...actual, getRoomQr: jest.fn() }
})

const roomService = require('../../miniprogram/services/room-service')
const entryService = require('../../miniprogram/services/entry-service')
const inviteService = require('../../miniprogram/services/invite-service')
const {
  loadPageOptions,
  createInstance,
  createWxMock,
  flushPromises,
  mockGetApp
} = require('../helpers/page-harness')

const opts = loadPageOptions('../../miniprogram/pages/room/room')

const TS = new Date(2026, 10, 7, 20, 0).getTime()

function entryFixture(i) {
  return {
    entryId: `e_${i}`,
    roomId: 'r_1',
    fromOpenid: 'o_me',
    fromNickname: '我',
    toOpenid: 'o_b',
    toNickname: '小王',
    amountCents: 100,
    amountText: '¥1.00',
    createdAt: TS + i
  }
}

function detailFixture({ status = 'active', recent = [entryFixture(1), entryFixture(2)], permissions } = {}) {
  return {
    room: {
      roomId: 'r_1',
      name: '周五夜场',
      inviteCode: 'A7K2M9',
      ownerOpenid: 'o_me',
      status,
      memberCount: 2,
      createdAt: TS,
      endedAt: status === 'ended' ? TS + 1 : null
    },
    members: [
      { openid: 'o_me', nickname: '我', avatarFileID: '', joinedAt: 1 },
      { openid: 'o_b', nickname: '小王', avatarFileID: 'cloud://b.png', joinedAt: 2 }
    ],
    settlement: [
      { openid: 'o_me', nickname: '我', avatarFileID: '', totalCents: -100 },
      { openid: 'o_b', nickname: '小王', avatarFileID: '', totalCents: 100 }
    ],
    recentEntries: recent,
    permissions: permissions || {
      canAddEntry: status === 'active',
      canEndRoom: status === 'active' && true,
      canInvite: status === 'active',
      canDeleteRoom: true // 房主（o_me）任何状态下均可删除
    }
  }
}

let wx
let intervalSpy
let timeoutsRun

beforeEach(() => {
  jest.clearAllMocks()
  wx = createWxMock()
  global.wx = wx
  mockGetApp({ user: { openid: 'o_me', nickname: '我', profileComplete: true }, needProfile: false })

  intervalSpy = { cb: null, ms: null, cleared: false }
  global.setInterval = jest.fn((cb, ms) => {
    intervalSpy.cb = cb
    intervalSpy.ms = ms
    return 77
  })
  global.clearInterval = jest.fn(() => {
    intervalSpy.cleared = true
  })
  timeoutsRun = []
  global.setTimeout = jest.fn((cb) => {
    timeoutsRun.push(cb)
    return 1
  })
})

async function openRoom(options = { id: 'r_1' }) {
  const inst = createInstance(opts)
  inst.onLoad(options)
  await inst.onShow()
  await flushPromises()
  return inst
}

describe('pages/room', () => {
  test('缺少 id 参数 -> 错误态', async () => {
    const inst = createInstance(opts)
    inst.onLoad({})
    await flushPromises()
    expect(inst.data.error.message).toBe('缺少牌局参数')
    expect(roomService.getRoomDetail).not.toHaveBeenCalled()
  })

  test('onShow 加载详情：成员房主标识、结算、只读位、时间文本', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    expect(roomService.getRoomDetail).toHaveBeenCalledWith('r_1')
    expect(inst.data.room.name).toBe('周五夜场')
    expect(inst.data.members[0].isOwner).toBe(true)
    expect(inst.data.members[1].isOwner).toBe(false)
    expect(inst.data.settlement).toHaveLength(2)
    expect(inst.data.createdAtStr).toBe('2026-11-07 20:00')
    expect(inst.data.endedReadonly).toBe(false)
    expect(inst.data.entries).toHaveLength(2)
    expect(inst.data.entriesHasMore).toBe(false)
  })

  test('进行中每 10 秒轮询；onHide 停止', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    expect(intervalSpy.ms).toBe(10000)

    roomService.getRoomDetail.mockResolvedValue(detailFixture({ recent: [entryFixture(3)] }))
    intervalSpy.cb()
    await flushPromises()
    expect(roomService.getRoomDetail).toHaveBeenCalledTimes(2)

    inst.onHide()
    expect(global.clearInterval).toHaveBeenCalled()
    intervalSpy.cb = null
  })

  test('已结束：只读、不轮询', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture({ status: 'ended' }))
    const inst = await openRoom()
    expect(inst.data.endedReadonly).toBe(true)
    expect(intervalSpy.cb).toBeNull()
  })

  test('静默轮询失败保留旧数据', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    roomService.getRoomDetail.mockRejectedValue({ code: 'NETWORK_ERROR' })
    await intervalSpy.cb()
    await flushPromises()
    expect(inst.data.room.name).toBe('周五夜场')
    expect(inst.data.error).toBeNull()
  })

  test('openInvite=1：加载完成后自动打开邀请并生成二维码', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    inviteService.getRoomQr.mockResolvedValue({
      fileID: 'cloud://q.png',
      inviteCode: 'A7K2M9',
      sharePath: '/pages/join/join?code=A7K2M9'
    })
    const inst = await openRoom({ id: 'r_1', openInvite: '1' })
    expect(inst.data.inviteVisible).toBe(true)
    expect(inviteService.getRoomQr).toHaveBeenCalledWith('r_1')
    expect(inst.data.qrFileID).toBe('cloud://q.png')
    expect(inst.data.qrLoading).toBe(false)
  })

  test('二维码失败 -> 错误文案 + 重试成功后清除', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    inviteService.getRoomQr.mockRejectedValue({ code: 5002, message: 'QR_GENERATE_FAILED' })
    const inst = await openRoom()
    inst.tapInvite()
    await flushPromises()
    expect(inst.data.qrError).toBe('小程序码生成失败')

    inviteService.getRoomQr.mockResolvedValue({ fileID: 'cloud://ok.png', inviteCode: 'A7K2M9' })
    inst.onInviteRetry()
    await flushPromises()
    expect(inst.data.qrFileID).toBe('cloud://ok.png')
    expect(inst.data.qrError).toBe('')
    expect(inviteService.getRoomQr).toHaveBeenCalledTimes(2)
  })

  test('复制邀请码（未生成二维码时也可复制邀请码）', () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    return openRoom().then((inst) => {
      inst.onCopyCode({ detail: { code: 'A7K2M9' } })
      expect(wx.setClipboardData).toHaveBeenCalledWith({ data: 'A7K2M9' })
    })
  })

  test('onShareAppMessage -> 标题含牌局名、路径含邀请码', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    const msg = inst.onShareAppMessage()
    expect(msg.title).toContain('周五夜场')
    expect(msg.path).toBe('/pages/join/join?code=A7K2M9')
  })

  test('结束牌局：确认 -> endRoom -> 刷新只读并停轮询', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    roomService.endRoom.mockResolvedValue({ room: { roomId: 'r_1', status: 'ended' } })
    roomService.getRoomDetail.mockResolvedValue(detailFixture({ status: 'ended' }))

    inst.tapEnd()
    await flushPromises()
    expect(roomService.endRoom).toHaveBeenCalledWith('r_1')
    expect(wx.showToast).toHaveBeenCalledWith({ title: '牌局已结束', icon: 'success' })
    expect(inst.data.endedReadonly).toBe(true)
    expect(intervalSpy.cleared).toBe(true)
  })

  test('结束牌局：取消不发请求', async () => {
    wx.showModal.mockImplementation((o) => o.success({ confirm: false, cancel: true }))
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    inst.tapEnd()
    await flushPromises()
    expect(roomService.endRoom).not.toHaveBeenCalled()
  })

  test('流水触底分页：page 递增、无更多后停止', async () => {
    const many = Array.from({ length: 20 }, (_, i) => entryFixture(i))
    roomService.getRoomDetail.mockResolvedValue(detailFixture({ recent: many }))
    const inst = await openRoom()
    expect(inst.data.entriesHasMore).toBe(true)

    entryService.listEntries.mockResolvedValue({ items: [entryFixture(20)], page: 1, hasMore: false })
    inst.onReachBottom()
    await flushPromises()
    expect(entryService.listEntries).toHaveBeenCalledWith({ roomId: 'r_1', page: 1, pageSize: 20 })
    expect(inst.data.entries).toHaveLength(21)
    expect(inst.data.entriesHasMore).toBe(false)

    inst.onReachBottom()
    await flushPromises()
    expect(entryService.listEntries).toHaveBeenCalledTimes(1)
  })

  test('流水分页失败 -> Toast 不影响详情', async () => {
    const many = Array.from({ length: 20 }, (_, i) => entryFixture(i))
    roomService.getRoomDetail.mockResolvedValue(detailFixture({ recent: many }))
    const inst = await openRoom()
    entryService.listEntries.mockRejectedValue({ code: 5001 })
    inst.onReachBottom()
    await flushPromises()
    expect(wx.showToast).toHaveBeenCalled()
    expect(inst.data.room).not.toBeNull()
  })

  test('记一笔跳转', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    inst.tapAddEntry()
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/entry/entry?roomId=r_1' })
  })

  test('成员行带当前盈亏：文本、符号、色调、可点标记', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    const me = inst.data.members[0]
    const friend = inst.data.members[1]
    // 自己 -100 分：绿色带负号，不可点（自己）
    expect(me.plText).toBe('-¥1.00')
    expect(me.plTone).toBe('minus')
    expect(me.tappable).toBe(false)
    // 好友 +100 分：红色带正号，可点
    expect(friend.plText).toBe('+¥1.00')
    expect(friend.plTone).toBe('plus')
    expect(friend.tappable).toBe(true)
  })

  test('点击好友头像 -> 携带 payee 进入记一笔', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    inst.tapMember({ currentTarget: { dataset: { openid: 'o_b' } } })
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/entry/entry?roomId=r_1&payee=o_b' })
  })

  test('点击自己头像不跳转', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    inst.tapMember({ currentTarget: { dataset: { openid: 'o_me' } } })
    expect(wx.navigateTo).not.toHaveBeenCalled()
  })

  test('已结束牌局点击成员头像不跳转', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture({ status: 'ended' }))
    const inst = await openRoom()
    inst.tapMember({ currentTarget: { dataset: { openid: 'o_b' } } })
    expect(wx.navigateTo).not.toHaveBeenCalled()
    expect(inst.data.members[1].tappable).toBe(false)
  })

  test('房主删除：确认 -> deleteRoom -> 停轮询返回', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    roomService.deleteRoom.mockResolvedValue({ roomId: 'r_1', deleted: true, deletedEntries: 2 })

    inst.tapDelete()
    await flushPromises()
    expect(roomService.deleteRoom).toHaveBeenCalledWith('r_1')
    expect(wx.showToast).toHaveBeenCalledWith({ title: '已删除', icon: 'success' })
    expect(intervalSpy.cleared).toBe(true)
    expect(wx.navigateBack).toHaveBeenCalled()
  })

  test('删除：取消不发请求', async () => {
    wx.showModal.mockImplementation((o) => o.success({ confirm: false, cancel: true }))
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    inst.tapDelete()
    await flushPromises()
    expect(roomService.deleteRoom).not.toHaveBeenCalled()
    expect(wx.navigateBack).not.toHaveBeenCalled()
  })

  test('无删除权限点击删除 -> 不弹确认', async () => {
    roomService.getRoomDetail.mockResolvedValue(
      detailFixture({
        permissions: { canAddEntry: true, canEndRoom: false, canInvite: true, canDeleteRoom: false }
      })
    )
    const inst = await openRoom()
    inst.tapDelete()
    expect(wx.showModal).not.toHaveBeenCalled()
    expect(roomService.deleteRoom).not.toHaveBeenCalled()
  })

  test('删除遇到 ROOM_NOT_FOUND（并发已删）-> 静默返回', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    roomService.deleteRoom.mockRejectedValue({ code: 2001, message: 'ROOM_NOT_FOUND' })
    inst.tapDelete()
    await flushPromises()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.navigateBack).toHaveBeenCalled()
  })

  test('权限缺失时不打开邀请', async () => {
    roomService.getRoomDetail.mockResolvedValue(
      detailFixture({ permissions: { canAddEntry: false, canEndRoom: false, canInvite: false } })
    )
    const inst = await openRoom()
    inst.tapInvite()
    await flushPromises()
    expect(inviteService.getRoomQr).not.toHaveBeenCalled()
  })
})
