/**
 * room-service 单元测试 — mock api-client 验证参数传递与错误映射
 */

jest.mock('../../miniprogram/services/api-client', () => {
  const actual = jest.requireActual('../../miniprogram/services/api-client')
  return { ...actual, call: jest.fn() }
})

const apiClient = require('../../miniprogram/services/api-client')
const roomService = require('../../miniprogram/services/room-service')

const mockCall = apiClient.call

beforeEach(() => mockCall.mockReset())

describe('createRoom', () => {
  test('透传 name 与 clientRequestId', async () => {
    mockCall.mockResolvedValue({ room: { roomId: 'r_1' } })
    const res = await roomService.createRoom({ name: '周五场', clientRequestId: 'req-abc' })
    expect(mockCall).toHaveBeenCalledWith('room', 'create', {
      name: '周五场',
      clientRequestId: 'req-abc'
    })
    expect(res.room.roomId).toBe('r_1')
  })

  test('未传 name -> payload 不含 name 字段（v1.4 起名称可选）', async () => {
    mockCall.mockResolvedValue({ room: { roomId: 'r_1' } })
    await roomService.createRoom({ clientRequestId: 'req-abc' })
    expect(mockCall).toHaveBeenCalledWith('room', 'create', { clientRequestId: 'req-abc' })
    expect(mockCall.mock.calls[0][2]).not.toHaveProperty('name')
  })

  test('未传 clientRequestId -> 本地抛错，不发起请求（幂等键必须页面生成）', async () => {
    await expect(roomService.createRoom({ name: 'x' })).rejects.toThrow('clientRequestId')
    expect(mockCall).not.toHaveBeenCalled()
  })

  test('服务端 PROFILE_INCOMPLETE 错误原样透传', async () => {
    mockCall.mockRejectedValue(new apiClient.ApiError(1002, 'PROFILE_INCOMPLETE'))
    await expect(
      roomService.createRoom({ name: 'x', clientRequestId: 'req-1' })
    ).rejects.toMatchObject({ code: 1002 })
  })
})

describe('joinRoom', () => {
  test('透传 inviteCode', async () => {
    mockCall.mockResolvedValue({ room: { roomId: 'r_1' }, alreadyMember: false })
    const res = await roomService.joinRoom('A7K2M9')
    expect(mockCall).toHaveBeenCalledWith('room', 'join', { inviteCode: 'A7K2M9' })
    expect(res.alreadyMember).toBe(false)
  })

  test('INVALID_INVITE_CODE_FORMAT 透传', async () => {
    mockCall.mockRejectedValue(new apiClient.ApiError(4002, 'INVALID_INVITE_CODE_FORMAT'))
    await expect(roomService.joinRoom('ab')).rejects.toMatchObject({ code: 4002 })
  })

  test('ROOM_FULL 透传', async () => {
    mockCall.mockRejectedValue(new apiClient.ApiError(2005, 'ROOM_FULL'))
    await expect(roomService.joinRoom('ABC234')).rejects.toMatchObject({ code: 2005 })
  })
})

describe('listRooms', () => {
  test('默认 page=0、pageSize=20', async () => {
    mockCall.mockResolvedValue({ items: [], page: 0, hasMore: false })
    await roomService.listRooms()
    expect(mockCall).toHaveBeenCalledWith('room', 'list', { page: 0, pageSize: 20 })
  })

  test('透传分页参数', async () => {
    mockCall.mockResolvedValue({ items: [], page: 2, hasMore: true })
    const res = await roomService.listRooms({ page: 2, pageSize: 10 })
    expect(mockCall).toHaveBeenCalledWith('room', 'list', { page: 2, pageSize: 10 })
    expect(res.hasMore).toBe(true)
  })
})

describe('getRoomDetail / endRoom', () => {
  test('detail 透传 roomId', async () => {
    mockCall.mockResolvedValue({ room: { roomId: 'r_9' }, permissions: {} })
    const res = await roomService.getRoomDetail('r_9')
    expect(mockCall).toHaveBeenCalledWith('room', 'detail', { roomId: 'r_9' })
    expect(res.room.roomId).toBe('r_9')
  })

  test('NOT_ROOM_MEMBER 透传', async () => {
    mockCall.mockRejectedValue(new apiClient.ApiError(2003, 'NOT_ROOM_MEMBER'))
    await expect(roomService.getRoomDetail('r_9')).rejects.toMatchObject({ code: 2003 })
  })

  test('end 透传 roomId', async () => {
    mockCall.mockResolvedValue({ room: { roomId: 'r_9', status: 'ended' } })
    await roomService.endRoom('r_9')
    expect(mockCall).toHaveBeenCalledWith('room', 'end', { roomId: 'r_9' })
  })

  test('NOT_ROOM_OWNER 透传', async () => {
    mockCall.mockRejectedValue(new apiClient.ApiError(2004, 'NOT_ROOM_OWNER'))
    await expect(roomService.endRoom('r_9')).rejects.toMatchObject({ code: 2004 })
  })
})

describe('deleteRoom', () => {
  test('remove 透传 roomId', async () => {
    mockCall.mockResolvedValue({ roomId: 'r_9', deleted: true, deletedEntries: 3 })
    const res = await roomService.deleteRoom('r_9')
    expect(mockCall).toHaveBeenCalledWith('room', 'remove', { roomId: 'r_9' })
    expect(res.deleted).toBe(true)
    expect(res.deletedEntries).toBe(3)
  })

  test('NOT_ROOM_OWNER 透传', async () => {
    mockCall.mockRejectedValue(new apiClient.ApiError(2004, 'NOT_ROOM_OWNER'))
    await expect(roomService.deleteRoom('r_9')).rejects.toMatchObject({ code: 2004 })
  })

  test('ROOM_NOT_FOUND 透传', async () => {
    mockCall.mockRejectedValue(new apiClient.ApiError(2001, 'ROOM_NOT_FOUND'))
    await expect(roomService.deleteRoom('r_9')).rejects.toMatchObject({ code: 2001 })
  })
})
