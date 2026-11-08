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
const cache = require('../../miniprogram/utils/cache')
const {
  loadPageOptions,
  createInstance,
  createWxMock,
  flushPromises,
  mockGetApp
} = require('../helpers/page-harness')

const opts = loadPageOptions('../../miniprogram/pages/room/room')

const TS = new Date(2026, 10, 7, 20, 0).getTime()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

function detailFixture({
  status = 'active',
  recent = [entryFixture(1), entryFixture(2)],
  permissions,
  lastActivityAt,
  autoEndAt,
  endReason
} = {}) {
  return {
    room: {
      roomId: 'r_1',
      name: '周五夜场',
      inviteCode: '8234',
      ownerOpenid: 'o_me',
      status,
      memberCount: 2,
      createdAt: TS,
      endedAt: status === 'ended' ? TS + 1 : null,
      // v2.6：闲置自动结束字段（缺省不下发，模拟历史数据）
      lastActivityAt,
      autoEndAt,
      endReason: status === 'ended' ? endReason === undefined ? null : endReason : null
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
      canDeleteRoom: status === 'ended' // v1.5：仅房主且已结束可删除
    }
  }
}

let wx
let intervalSpy
let timeoutsRun

beforeEach(() => {
  jest.clearAllMocks()
  cache.clearAll() // v2.5 内存缓存为模块级状态，用例间须隔离
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

  test('onShow 加载详情：成员房主标识、头像盈亏、只读位、时间文本（v2.0 结算统计已移除）', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    expect(roomService.getRoomDetail).toHaveBeenCalledWith('r_1')
    expect(inst.data.room.name).toBe('周五夜场')
    expect(inst.data.members[0].isOwner).toBe(true)
    expect(inst.data.members[1].isOwner).toBe(false)
    // 结算净额不再单独入 data，仅映射为头像下方盈亏文本（符号显式）
    expect(inst.data.settlement).toBeUndefined()
    expect(inst.data.members[0].plText).toBe('-¥1.00')
    expect(inst.data.members[0].plTone).toBe('minus')
    expect(inst.data.members[1].plText).toBe('+¥1.00')
    expect(inst.data.members[1].plTone).toBe('plus')
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

  describe('v2.6 闲置自动结束的页面标注', () => {
    const DAY = 24 * 60 * 60 * 1000

    test('临近自动结束（<2 天）-> 预告文案按剩余天数向上取整', async () => {
      roomService.getRoomDetail.mockResolvedValue(
        detailFixture({ lastActivityAt: Date.now() - 6 * DAY, autoEndAt: Date.now() + 1.5 * DAY })
      )
      const inst = await openRoom()
      expect(inst.data.idlePrewarnText).toBe('久未记账，约 2 天后将自动结束')
      expect(inst.data.endedReadonly).toBe(false) // 预告不等于已结束
    })

    test('剩余不足一天 -> 至少显示「约 1 天后」', async () => {
      roomService.getRoomDetail.mockResolvedValue(detailFixture({ autoEndAt: Date.now() + 3600 * 1000 }))
      const inst = await openRoom()
      expect(inst.data.idlePrewarnText).toBe('久未记账，约 1 天后将自动结束')
    })

    test('定时器尚未扫描（autoEndAt 已过）-> 即将自动结束', async () => {
      roomService.getRoomDetail.mockResolvedValue(detailFixture({ autoEndAt: Date.now() - 1000 }))
      const inst = await openRoom()
      expect(inst.data.idlePrewarnText).toBe('久未记账，本场牌局即将自动结束')
    })

    test('距自动结束尚远 / 服务端未下发 autoEndAt -> 不预告', async () => {
      roomService.getRoomDetail.mockResolvedValue(detailFixture({ autoEndAt: Date.now() + 5 * DAY }))
      const far = await openRoom()
      expect(far.data.idlePrewarnText).toBe('')

      cache.clearAll()
      roomService.getRoomDetail.mockResolvedValue(detailFixture()) // 历史数据无该字段
      const legacy = await openRoom()
      expect(legacy.data.idlePrewarnText).toBe('')
    })

    test('长期未记账被自动结束 -> 标注为自动结束；房主手动结束 -> 中性标注', async () => {
      roomService.getRoomDetail.mockResolvedValue(detailFixture({ status: 'ended', endReason: 'idle' }))
      const auto = await openRoom()
      expect(auto.data.endedReadonly).toBe(true)
      expect(auto.data.endedByIdle).toBe(true)
      expect(auto.data.idlePrewarnText).toBe('') // 已结束不再预告

      cache.clearAll()
      roomService.getRoomDetail.mockResolvedValue(detailFixture({ status: 'ended', endReason: 'owner' }))
      const manual = await openRoom()
      expect(manual.data.endedByIdle).toBe(false)

      cache.clearAll()
      roomService.getRoomDetail.mockResolvedValue(detailFixture({ status: 'ended' })) // 历史房间 endReason=null
      const legacy = await openRoom()
      expect(legacy.data.endedByIdle).toBe(false)
    })

    test('记账后轮询取到新活跃时间 -> 预告消失', async () => {
      roomService.getRoomDetail.mockResolvedValue(detailFixture({ autoEndAt: Date.now() + DAY }))
      const inst = await openRoom()
      expect(inst.data.idlePrewarnText).not.toBe('')

      roomService.getRoomDetail.mockResolvedValue(
        detailFixture({ recent: [entryFixture(1), entryFixture(2), entryFixture(3)], autoEndAt: Date.now() + 7 * DAY })
      )
      await intervalSpy.cb()
      await flushPromises()
      expect(inst.data.idlePrewarnText).toBe('')
    })
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
      inviteCode: '8234',
      sharePath: '/pages/join/join?code=8234'
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

    inviteService.getRoomQr.mockResolvedValue({ fileID: 'cloud://ok.png', inviteCode: '8234' })
    inst.onInviteRetry()
    await flushPromises()
    expect(inst.data.qrFileID).toBe('cloud://ok.png')
    expect(inst.data.qrError).toBe('')
    expect(inviteService.getRoomQr).toHaveBeenCalledTimes(2)
  })

  test('复制邀请码（未生成二维码时也可复制邀请码）', () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    return openRoom().then((inst) => {
      inst.onCopyCode({ detail: { code: '8234' } })
      expect(wx.setClipboardData).toHaveBeenCalledWith({ data: '8234' })
    })
  })

  test('复制邀请码：事件对象缺省也不抛错，兜底页面已有邀请码', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    expect(() => inst.onCopyCode()).not.toThrow()
    expect(wx.setClipboardData).toHaveBeenLastCalledWith({ data: '8234' })
    expect(() => inst.onCopyCode({})).not.toThrow()
    expect(wx.setClipboardData).toHaveBeenLastCalledWith({ data: '8234' })
  })

  test('onShareAppMessage -> 标题含牌局名、路径含邀请码', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    const msg = inst.onShareAppMessage()
    expect(msg.title).toContain('周五夜场')
    expect(msg.path).toBe('/pages/join/join?code=8234')
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

  test('v2.3 滚动区触底事件走同一分页逻辑', async () => {
    const many = Array.from({ length: 20 }, (_, i) => entryFixture(i))
    roomService.getRoomDetail.mockResolvedValue(detailFixture({ recent: many }))
    const inst = await openRoom()
    entryService.listEntries.mockResolvedValue({ items: [entryFixture(20)], page: 1, hasMore: false })
    inst.onEntriesReachBottom()
    await flushPromises()
    expect(entryService.listEntries).toHaveBeenCalledWith({ roomId: 'r_1', page: 1, pageSize: 20 })
    expect(inst.data.entries).toHaveLength(21)
    expect(inst.data.entriesHasMore).toBe(false)
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

  test('记账不再跳转页面：tapAddEntry 已随记一笔页移除（v1.7）', () => {
    expect(opts.tapAddEntry).toBeUndefined()
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

  test('点击好友头像 -> 打开记账弹层（目标信息 + 打开时生成幂等键）', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    inst.tapMember({ currentTarget: { dataset: { openid: 'o_b' } } })
    expect(wx.navigateTo).not.toHaveBeenCalled()
    expect(inst.data.entryVisible).toBe(true)
    expect(inst.data.entryTarget).toEqual({ openid: 'o_b', nickname: '小王', avatarFileID: 'cloud://b.png' })
    expect(inst.data.entryError).toBe('')
    expect(inst._entryClientRequestId).toMatch(UUID_RE)
  })

  test('v2.4 默认头像兜底：空头像成员与记账弹层目标均落默认小人', async () => {
    const d = detailFixture()
    d.members[1].avatarFileID = ''
    roomService.getRoomDetail.mockResolvedValue(d)
    const inst = await openRoom()
    // fixture 中 o_me 本就为空，o_b 改为空：均兜底
    expect(inst.data.members[0].avatarFileID).toBe('/images/default-avatar.png')
    expect(inst.data.members[1].avatarFileID).toBe('/images/default-avatar.png')
    inst.tapMember({ currentTarget: { dataset: { openid: 'o_b' } } })
    expect(inst.data.entryTarget.avatarFileID).toBe('/images/default-avatar.png')
  })

  test('弹层打开中再点头像 -> 不重复打开、不换幂等键', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    inst.tapMember({ currentTarget: { dataset: { openid: 'o_b' } } })
    const key = inst._entryClientRequestId
    inst.tapMember({ currentTarget: { dataset: { openid: 'o_b' } } })
    expect(inst._entryClientRequestId).toBe(key)
  })

  test('点击自己头像不开弹层', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    inst.tapMember({ currentTarget: { dataset: { openid: 'o_me' } } })
    expect(inst.data.entryVisible).toBe(false)
  })

  test('已结束牌局点击成员头像不开弹层', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture({ status: 'ended' }))
    const inst = await openRoom()
    inst.tapMember({ currentTarget: { dataset: { openid: 'o_b' } } })
    expect(inst.data.entryVisible).toBe(false)
    expect(inst.data.members[1].tappable).toBe(false)
  })

  test('弹层确认：payload 完整、付款人为自己 -> 关闭 + Toast + 静默刷新', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    inst.tapMember({ currentTarget: { dataset: { openid: 'o_b' } } })
    const key = inst._entryClientRequestId
    entryService.addEntry.mockResolvedValue({ entry: { entryId: 'e_9' }, duplicated: false })

    await inst.onEntryConfirm({ detail: { valueCents: 5000 } })
    expect(entryService.addEntry).toHaveBeenCalledWith({
      roomId: 'r_1',
      fromOpenid: 'o_me',
      toOpenid: 'o_b',
      amountCents: 5000,
      clientRequestId: key
    })
    expect(inst.data.entryVisible).toBe(false)
    expect(inst.data.entryTarget).toBeNull()
    expect(wx.showToast).toHaveBeenCalledWith({ title: '已记录', icon: 'success' })
    expect(roomService.getRoomDetail).toHaveBeenCalledTimes(2) // 静默刷新盈亏与流水
  })

  test('金额为 0 / 弹层未打开 -> 确认不发请求', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    inst.tapMember({ currentTarget: { dataset: { openid: 'o_b' } } })
    await inst.onEntryConfirm({ detail: { valueCents: 0 } })
    expect(entryService.addEntry).not.toHaveBeenCalled()
    inst.onEntryClose()
    await inst.onEntryConfirm({ detail: { valueCents: 100 } })
    expect(entryService.addEntry).not.toHaveBeenCalled()
  })

  test('保存失败：弹层保留、错误文案、重试复用同一幂等键', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    inst.tapMember({ currentTarget: { dataset: { openid: 'o_b' } } })
    const key = inst._entryClientRequestId

    entryService.addEntry.mockRejectedValue({ code: 3004, message: 'INVALID_MEMBER' })
    await inst.onEntryConfirm({ detail: { valueCents: 3000 } })
    expect(inst.data.entryVisible).toBe(true)
    expect(inst.data.entryError).toBe('成员选择无效，请重新选择')
    expect(inst.data.entrySubmitting).toBe(false)

    entryService.addEntry.mockResolvedValue({ entry: {}, duplicated: false })
    await inst.onEntryConfirm({ detail: { valueCents: 3000 } })
    expect(entryService.addEntry).toHaveBeenLastCalledWith(expect.objectContaining({ clientRequestId: key }))
  })

  test('致命失败（已结束/非成员）-> 关闭弹层 + Toast + 刷新最新状态', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    inst.tapMember({ currentTarget: { dataset: { openid: 'o_b' } } })
    roomService.getRoomDetail.mockResolvedValue(detailFixture({ status: 'ended' }))
    entryService.addEntry.mockRejectedValue({ code: 2002, message: 'ROOM_ENDED' })

    await inst.onEntryConfirm({ detail: { valueCents: 100 } })
    expect(inst.data.entryVisible).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({ title: '牌局已结束，数据仅可查看', icon: 'none' })
    await flushPromises()
    expect(inst.data.endedReadonly).toBe(true)
  })

  test('提交中：忽略关闭与重复确认', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openRoom()
    inst.tapMember({ currentTarget: { dataset: { openid: 'o_b' } } })
    let resolveAdd
    entryService.addEntry.mockImplementation(() => new Promise((r) => (resolveAdd = r)))

    const pending = inst.onEntryConfirm({ detail: { valueCents: 100 } })
    expect(inst.data.entrySubmitting).toBe(true)
    inst.onEntryClose()
    expect(inst.data.entryVisible).toBe(true) // 关闭被忽略
    await inst.onEntryConfirm({ detail: { valueCents: 200 } })
    expect(entryService.addEntry).toHaveBeenCalledTimes(1) // 重复确认被拦截
    resolveAdd({ entry: {}, duplicated: false })
    await pending
    expect(inst.data.entryVisible).toBe(false)
  })

  test('房主删除（已结束牌局）：确认 -> deleteRoom -> 返回', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture({ status: 'ended' }))
    const inst = await openRoom()
    roomService.deleteRoom.mockResolvedValue({ roomId: 'r_1', deleted: true, deletedEntries: 2 })

    inst.tapDelete()
    await flushPromises()
    expect(roomService.deleteRoom).toHaveBeenCalledWith('r_1')
    expect(wx.showToast).toHaveBeenCalledWith({ title: '已删除', icon: 'success' })
    expect(wx.navigateBack).toHaveBeenCalled()
  })

  test('进行中牌局无删除权限 -> 点击不弹确认（v1.5）', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture()) // active，默认 canDeleteRoom=false
    const inst = await openRoom()
    inst.tapDelete()
    await flushPromises()
    expect(wx.showModal).not.toHaveBeenCalled()
    expect(roomService.deleteRoom).not.toHaveBeenCalled()
  })

  test('删除：取消不发请求', async () => {
    wx.showModal.mockImplementation((o) => o.success({ confirm: false, cancel: true }))
    roomService.getRoomDetail.mockResolvedValue(detailFixture({ status: 'ended' }))
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
    roomService.getRoomDetail.mockResolvedValue(detailFixture({ status: 'ended' }))
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

  describe('v2.5 内存缓存 SWR', () => {
    test('成功加载写入详情缓存', async () => {
      roomService.getRoomDetail.mockResolvedValue(detailFixture())
      expect(cache.get(cache.keys.roomDetail('r_1'))).toBeUndefined()
      await openRoom()
      expect(cache.get(cache.keys.roomDetail('r_1'))).toBeDefined()
    })

    test('再次进入：先同步渲染缓存（不出骨架），随后新数据覆盖', async () => {
      roomService.getRoomDetail.mockResolvedValue(
        detailFixture({ recent: [entryFixture(1), entryFixture(2)] })
      )
      await openRoom() // 缓存两条流水

      const fresh = detailFixture({ recent: [entryFixture(9)] })
      roomService.getRoomDetail.mockResolvedValue(fresh)
      const inst = createInstance(opts)
      inst.onLoad({ id: 'r_1' })
      inst.onShow() // 触发 loadDetail（非静默）
      // SWR 首屏：缓存的两条流水立即渲染，未经 loading 骨架
      expect(inst.data.loading).toBe(false)
      expect(inst.data.entries).toHaveLength(2)
      expect(inst.data.entries[0].entryId).toBe('e_1')

      await flushPromises() // 后台校准落地
      expect(inst.data.entries).toHaveLength(1)
      expect(inst.data.entries[0].entryId).toBe('e_9')
    })

    test('缓存命中后校准失败：保留缓存渲染，不进错误页', async () => {
      roomService.getRoomDetail.mockResolvedValue(detailFixture())
      await openRoom()

      roomService.getRoomDetail.mockRejectedValue({ code: 5001, message: 'INTERNAL_ERROR' })
      const inst = createInstance(opts)
      inst.onLoad({ id: 'r_1' })
      await inst.onShow()
      await flushPromises()
      expect(inst.data.error).toBeNull()
      expect(inst.data.entries).toHaveLength(2)
    })

    test('记一笔成功：详情缓存先失效，全量刷新后写回', async () => {
      roomService.getRoomDetail.mockResolvedValue(detailFixture())
      const inst = await openRoom()
      expect(cache.get(cache.keys.roomDetail('r_1'))).toBeDefined()

      entryService.addEntry.mockResolvedValue({ entryId: 'e_new' })
      roomService.getRoomDetail.mockResolvedValue(
        detailFixture({ recent: [entryFixture(1), entryFixture(2), entryFixture(3)] })
      )
      inst.setData({ entryTarget: { openid: 'o_b', nickname: '小王' } })
      await inst.onEntryConfirm({ detail: { valueCents: 500 } })
      await flushPromises()
      // 刷新落地后缓存含新笔（维持全量刷新，非本地追加）
      expect(cache.get(cache.keys.roomDetail('r_1')).recentEntries).toHaveLength(3)
    })

    test('结束牌局：详情与列表缓存都失效（详情随后回写）', async () => {
      roomService.getRoomDetail.mockResolvedValue(detailFixture({ status: 'active' }))
      cache.set(cache.keys.roomsList(), { items: [{ roomId: 'r_1' }] })
      const inst = await openRoom()
      roomService.endRoom.mockResolvedValue({})
      roomService.getRoomDetail.mockResolvedValue(detailFixture({ status: 'ended' }))
      await inst.doEnd()
      await flushPromises()
      // 列表键被写时失效且详情刷新不会回写它，避免首页渲染「进行中」脏状态
      expect(cache.get(cache.keys.roomsList())).toBeUndefined()
      expect(cache.get(cache.keys.roomDetail('r_1')).room.status).toBe('ended')
    })
  })
})
