/**
 * invite-service 单元测试
 */

jest.mock('../../miniprogram/services/api-client', () => {
  const actual = jest.requireActual('../../miniprogram/services/api-client')
  return { ...actual, call: jest.fn() }
})

const apiClient = require('../../miniprogram/services/api-client')
const inviteService = require('../../miniprogram/services/invite-service')

const mockCall = apiClient.call

beforeEach(() => mockCall.mockReset())

describe('getRoomQr', () => {
  test('透传 roomId 并返回云函数结果', async () => {
    const payload = { fileID: 'cloud://x', inviteCode: '8234', sharePath: '/pages/join/join?code=8234' }
    mockCall.mockResolvedValue(payload)
    const res = await inviteService.getRoomQr('r_1')
    expect(mockCall).toHaveBeenCalledWith('invite', 'qr', { roomId: 'r_1' })
    expect(res.inviteCode).toBe('8234')
  })

  test('ROOM_ENDED 透传', async () => {
    mockCall.mockRejectedValue(new apiClient.ApiError(2002, 'ROOM_ENDED'))
    await expect(inviteService.getRoomQr('r_1')).rejects.toMatchObject({ code: 2002 })
  })

  test('QR_GENERATE_FAILED 透传', async () => {
    mockCall.mockRejectedValue(new apiClient.ApiError(5002, 'QR_GENERATE_FAILED'))
    await expect(inviteService.getRoomQr('r_1')).rejects.toMatchObject({ code: 5002 })
  })
})

describe('getSharePath / getShareMessage', () => {
  test('分享路径格式', () => {
    expect(inviteService.getSharePath('8234')).toBe('/pages/join/join?code=8234')
  })

  test('分享消息含牌局名与路径', () => {
    const msg = inviteService.getShareMessage({ name: '周五夜场', inviteCode: '8234' })
    expect(msg.title).toContain('周五夜场')
    expect(msg.path).toBe('/pages/join/join?code=8234')
  })

  test('房间名缺失时标题兜底', () => {
    const msg = inviteService.getShareMessage({ inviteCode: '0421' })
    expect(msg.title).toBeTruthy()
    expect(msg.path).toContain('0421')
  })
})

describe('parseJoinScene', () => {
  test.each([
    ['c=8234', '8234'],
    ['c%3D8234', '8234'],
    ['c=0823', '0823'],
    ['', ''],
    ['garbage', ''],
    ['c=', ''],
    [null, ''],
    [undefined, '']
  ])('scene %p -> %p', (input, expected) => {
    expect(inviteService.parseJoinScene(input)).toBe(expected)
  })
})

describe('parseJoinCode', () => {
  test('trim 规范化（v2.0 数字码）', () => {
    expect(inviteService.parseJoinCode(' 0823 ')).toBe('0823')
    expect(inviteService.parseJoinCode('')).toBe('')
    expect(inviteService.parseJoinCode(null)).toBe('')
  })
})
