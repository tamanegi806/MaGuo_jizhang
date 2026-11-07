/**
 * 记一笔页测试 — v1.6 付款人锁定自己/收款人/预览/幂等键生命周期/错误分支
 */

jest.mock('../../miniprogram/services/room-service', () => ({
  listRooms: jest.fn(),
  createRoom: jest.fn(),
  joinRoom: jest.fn(),
  getRoomDetail: jest.fn(),
  endRoom: jest.fn()
}))
jest.mock('../../miniprogram/services/entry-service', () => ({
  addEntry: jest.fn(),
  listEntries: jest.fn()
}))

const roomService = require('../../miniprogram/services/room-service')
const entryService = require('../../miniprogram/services/entry-service')
const {
  loadPageOptions,
  createInstance,
  createWxMock,
  flushPromises,
  mockGetApp
} = require('../helpers/page-harness')

const opts = loadPageOptions('../../miniprogram/pages/entry/entry')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const MEMBERS = [
  { openid: 'o_me', nickname: '我', avatarFileID: '', joinedAt: 1 },
  { openid: 'o_b', nickname: '小王', avatarFileID: '', joinedAt: 2 },
  { openid: 'o_c', nickname: '张三', avatarFileID: '', joinedAt: 3 }
]

function detailFixture({ status = 'active', canAddEntry = true } = {}) {
  return {
    room: {
      roomId: 'r_1',
      name: '周五夜场',
      inviteCode: 'A7K2M9',
      ownerOpenid: 'o_me',
      status,
      memberCount: 3,
      createdAt: 1,
      endedAt: null
    },
    members: MEMBERS,
    settlement: [],
    recentEntries: [],
    permissions: { canAddEntry, canEndRoom: true, canInvite: true }
  }
}

let wx
let globalData
let timeoutsRun

beforeEach(() => {
  jest.clearAllMocks()
  wx = createWxMock()
  global.wx = wx
  globalData = mockGetApp({ user: { openid: 'o_me', nickname: '我', profileComplete: true } })
  timeoutsRun = []
  global.setTimeout = jest.fn((cb) => {
    timeoutsRun.push(cb)
    return 1
  })
})

async function openEntry(options = { roomId: 'r_1' }) {
  const inst = createInstance(opts)
  inst.onLoad(options)
  await flushPromises()
  return inst
}

describe('pages/entry', () => {
  test('onLoad 生成 clientRequestId（UUID），付款人默认当前用户', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openEntry()
    expect(inst.data.clientRequestId).toMatch(UUID_RE)
    expect(inst.data.fromOpenid).toBe('o_me')
    expect(inst.data.members).toHaveLength(3)
  })

  test('缺少 roomId -> 错误态', async () => {
    const inst = createInstance(opts)
    inst.onLoad({})
    await flushPromises()
    expect(inst.data.error.message).toBe('缺少牌局参数')
  })

  test('payee 参数 -> 付款人默认自己、收款人预置为好友', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openEntry({ roomId: 'r_1', payee: 'o_b' })
    expect(inst.data.fromOpenid).toBe('o_me')
    expect(inst.data.toOpenid).toBe('o_b')
    // 金额未填，canSave 仍为 false
    expect(inst.data.canSave).toBe(false)
    inst.onAmountChange({ detail: { valueCents: 2000 } })
    expect(inst.data.canSave).toBe(true)
    expect(inst.data.preview).toEqual({ fromName: '我', toName: '小王', amountText: '¥20.00' })
  })

  test('payee 非成员或与付款人相同 -> 忽略预置', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const ghost = await openEntry({ roomId: 'r_1', payee: 'o_ghost' })
    expect(ghost.data.toOpenid).toBe('')

    const self = await openEntry({ roomId: 'r_1', payee: 'o_me' })
    expect(self.data.toOpenid).toBe('')
  })

  test('payee 预置后保存成功 -> 收款人清空不回填（连续录入按默认逻辑）', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openEntry({ roomId: 'r_1', payee: 'o_c' })
    expect(inst.data.toOpenid).toBe('o_c')
    inst.onAmountChange({ detail: { valueCents: 100 } })
    entryService.addEntry.mockResolvedValue({ entry: {}, duplicated: false })
    await inst.onSave()
    expect(entryService.addEntry).toHaveBeenCalledWith(
      expect.objectContaining({ fromOpenid: 'o_me', toOpenid: 'o_c' })
    )
    expect(inst.data.toOpenid).toBe('')
  })

  test('v1.6 当前用户不在成员中 -> 付款人仍锁定自己，不再回退房主', async () => {
    globalData.user = { openid: 'o_x' }
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openEntry()
    expect(inst.data.fromOpenid).toBe('o_x')
    expect(inst.data.meName).toBe('我') // 成员表查无自己 -> 兜底文案
  })

  test('v1.6 付款人选择与交换入口已移除', () => {
    expect(opts.onFromChange).toBeUndefined()
    expect(opts.tapSwap).toBeUndefined()
  })

  test('已结束牌局 -> 阻止进入并返回', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture({ status: 'ended' }))
    const inst = await openEntry()
    expect(wx.showToast).toHaveBeenCalledWith({ title: '牌局已结束，无法再记账', icon: 'none' })
    expect(wx.navigateBack).toHaveBeenCalled()
  })

  test('无记账权限 -> 阻止进入并返回', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture({ canAddEntry: false }))
    const inst = await openEntry()
    expect(wx.navigateBack).toHaveBeenCalled()
  })

  test('选择收款人与金额 -> 预览与 canSave', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openEntry()
    inst.onToChange({ detail: { openid: 'o_b' } })
    inst.onAmountChange({ detail: { valueCents: 5050 } })
    expect(inst.data.canSave).toBe(true)
    expect(inst.data.preview).toEqual({ fromName: '我', toName: '小王', amountText: '¥50.50' })
  })

  test('v1.6 服务端 3005 兜底 -> saveError 固定文案（旧版客户端场景）', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openEntry()
    inst.onToChange({ detail: { openid: 'o_b' } })
    inst.onAmountChange({ detail: { valueCents: 100 } })
    entryService.addEntry.mockRejectedValue({ code: 3005, message: 'PAYER_NOT_SELF' })
    await inst.onSave()
    expect(inst.data.saveError).toBe('只能记录自己付出去的流水')
    expect(wx.navigateBack).not.toHaveBeenCalled()
  })

  test('未选齐时保存不发请求', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openEntry()
    await inst.onSave()
    expect(entryService.addEntry).not.toHaveBeenCalled()
  })

  test('保存成功：payload 完整，保留付款人、清空收款人与金额、换新幂等键', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openEntry()
    inst.onToChange({ detail: { openid: 'o_b' } })
    inst.onAmountChange({ detail: { valueCents: 5000 } })
    const oldKey = inst.data.clientRequestId
    entryService.addEntry.mockResolvedValue({ entry: { entryId: 'e_1' }, duplicated: false })

    await inst.onSave()
    expect(entryService.addEntry).toHaveBeenCalledWith({
      roomId: 'r_1',
      fromOpenid: 'o_me',
      toOpenid: 'o_b',
      amountCents: 5000,
      clientRequestId: oldKey
    })
    expect(inst.data.fromOpenid).toBe('o_me')
    expect(inst.data.toOpenid).toBe('')
    expect(inst.data.amountCents).toBe(0)
    expect(inst.data.amountValue).toBe(0) // 先置旧值再归 0，驱动组件清空
    expect(inst.data.clientRequestId).toMatch(UUID_RE)
    expect(inst.data.clientRequestId).not.toBe(oldKey)
    expect(wx.showToast).toHaveBeenCalledWith({ title: '已记录', icon: 'success' })
  })

  test('保存失败：保留输入与幂等键，重试复用同一键', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openEntry()
    inst.onToChange({ detail: { openid: 'o_b' } })
    inst.onAmountChange({ detail: { valueCents: 3000 } })
    const key = inst.data.clientRequestId

    entryService.addEntry.mockRejectedValue({ code: 3004, message: 'INVALID_MEMBER' })
    await inst.onSave()
    expect(inst.data.saveError).toBe('成员选择无效，请重新选择')
    expect(inst.data.toOpenid).toBe('o_b')
    expect(inst.data.amountCents).toBe(3000)
    expect(inst.data.clientRequestId).toBe(key)
    expect(wx.navigateBack).not.toHaveBeenCalled()

    entryService.addEntry.mockResolvedValue({ entry: {}, duplicated: false })
    await inst.onSave()
    expect(entryService.addEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({ clientRequestId: key })
    )
  })

  test('同人错误码 3002 -> 友好提示且不返回', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openEntry()
    inst.onToChange({ detail: { openid: 'o_b' } })
    inst.onAmountChange({ detail: { valueCents: 100 } })
    entryService.addEntry.mockRejectedValue({ code: 3002, message: 'SAME_PAYER_PAYEE' })
    await inst.onSave()
    expect(inst.data.saveError).toBe('付款人和收款人不能是同一人')
  })

  test('牌局已结束错误 -> 返回详情只读态', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openEntry()
    inst.onToChange({ detail: { openid: 'o_b' } })
    inst.onAmountChange({ detail: { valueCents: 100 } })
    entryService.addEntry.mockRejectedValue({ code: 2002, message: 'ROOM_ENDED' })
    await inst.onSave()
    expect(inst.data.saveError).toContain('牌局已结束')
    expect(wx.navigateBack).not.toHaveBeenCalled() // 延迟返回
    expect(global.setTimeout).toHaveBeenCalled()
    timeoutsRun.length && timeoutsRun.forEach((cb) => cb())
    expect(wx.navigateBack).toHaveBeenCalled()
  })

  test('金额非法（0）不触发有效状态', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openEntry()
    inst.onToChange({ detail: { openid: 'o_b' } })
    inst.onAmountChange({ detail: { valueCents: 0 } })
    expect(inst.data.canSave).toBe(false)
  })

  test('完成按钮返回详情', async () => {
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    const inst = await openEntry()
    inst.tapDone()
    expect(wx.navigateBack).toHaveBeenCalled()
  })

  test('加载失败 -> 错误态与重试', async () => {
    roomService.getRoomDetail.mockRejectedValue({ code: 2003, message: 'NOT_ROOM_MEMBER' })
    const inst = await openEntry()
    expect(inst.data.error).toEqual({ code: 2003, message: '你不在该牌局中' })
    roomService.getRoomDetail.mockResolvedValue(detailFixture())
    inst.tapRetry()
    await flushPromises()
    expect(inst.data.loading).toBe(false)
    expect(inst.data.error).toBeNull()
  })
})
