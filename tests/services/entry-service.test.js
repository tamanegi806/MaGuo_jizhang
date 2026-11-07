/**
 * entry-service 单元测试 — mock api-client
 */

jest.mock('../../miniprogram/services/api-client', () => {
  const actual = jest.requireActual('../../miniprogram/services/api-client')
  return { ...actual, call: jest.fn() }
})

const apiClient = require('../../miniprogram/services/api-client')
const entryService = require('../../miniprogram/services/entry-service')

const mockCall = apiClient.call

beforeEach(() => mockCall.mockReset())

const input = {
  roomId: 'r_1',
  fromOpenid: 'o_a',
  toOpenid: 'o_b',
  amountCents: 5000,
  clientRequestId: 'req-fixed'
}

describe('addEntry', () => {
  test('透传五个字段', async () => {
    mockCall.mockResolvedValue({ entry: { entryId: 'e_1' }, duplicated: false })
    const res = await entryService.addEntry(input)
    expect(mockCall).toHaveBeenCalledWith('entry', 'add', {
      roomId: 'r_1',
      fromOpenid: 'o_a',
      toOpenid: 'o_b',
      amountCents: 5000,
      clientRequestId: 'req-fixed'
    })
    expect(res.entry.entryId).toBe('e_1')
  })

  test('clientRequestId 必传，服务层不做隐式新键', async () => {
    const { clientRequestId, ...rest } = input
    await expect(entryService.addEntry(rest)).rejects.toThrow('clientRequestId')
    expect(mockCall).not.toHaveBeenCalled()
  })

  test('失败重试复用同一 clientRequestId（服务层原样透传两次相同键）', async () => {
    mockCall
      .mockRejectedValueOnce(new apiClient.ApiError('NETWORK_ERROR', '网络异常'))
      .mockResolvedValueOnce({ entry: { entryId: 'e_1' }, duplicated: true })
    await expect(entryService.addEntry(input)).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    const res = await entryService.addEntry(input) // 页面重试：同键
    expect(res.duplicated).toBe(true)
    expect(mockCall.mock.calls[0][2].clientRequestId).toBe(
      mockCall.mock.calls[1][2].clientRequestId
    )
  })

  test('SAME_PAYER_PAYEE 等业务错误透传', async () => {
    mockCall.mockRejectedValue(new apiClient.ApiError(3002, 'SAME_PAYER_PAYEE'))
    await expect(entryService.addEntry(input)).rejects.toMatchObject({ code: 3002 })
  })

  test('ROOM_ENDED 透传', async () => {
    mockCall.mockRejectedValue(new apiClient.ApiError(2002, 'ROOM_ENDED'))
    await expect(entryService.addEntry(input)).rejects.toMatchObject({ code: 2002 })
  })
})

describe('listEntries', () => {
  test('默认分页参数', async () => {
    mockCall.mockResolvedValue({ items: [], page: 0, hasMore: false })
    await entryService.listEntries({ roomId: 'r_1' })
    expect(mockCall).toHaveBeenCalledWith('entry', 'list', { roomId: 'r_1', page: 0, pageSize: 20 })
  })

  test('透传分页', async () => {
    mockCall.mockResolvedValue({ items: [{ entryId: 'e_1' }], page: 1, hasMore: true })
    const res = await entryService.listEntries({ roomId: 'r_1', page: 1, pageSize: 10 })
    expect(mockCall).toHaveBeenCalledWith('entry', 'list', { roomId: 'r_1', page: 1, pageSize: 10 })
    expect(res.hasMore).toBe(true)
  })

  test('NOT_ROOM_MEMBER 透传', async () => {
    mockCall.mockRejectedValue(new apiClient.ApiError(2003, 'NOT_ROOM_MEMBER'))
    await expect(entryService.listEntries({ roomId: 'r_1' })).rejects.toMatchObject({ code: 2003 })
  })
})
