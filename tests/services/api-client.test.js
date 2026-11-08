/**
 * api-client 单元测试 — 06
 * mock wx.cloud.callFunction，不触碰真实云环境
 */

global.wx = { cloud: { callFunction: jest.fn() } }

const {
  call,
  ApiError,
  setRequestIdFactory,
  clearInflight,
  NETWORK_ERROR_CODE,
  NETWORK_ERROR_MESSAGE
} = require('../../miniprogram/services/api-client')

const FIXED_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

beforeEach(() => {
  wx.cloud.callFunction.mockReset()
  clearInflight() // v2.5 在途表为模块级状态，用例间须隔离
  setRequestIdFactory(() => FIXED_ID)
})

afterAll(() => {
  setRequestIdFactory(null)
})

const envelope = (code, message, data) => ({
  result: { code, message, data, requestId: FIXED_ID }
})

describe('call — 成功路径', () => {
  test('code === 0 时返回 data', async () => {
    wx.cloud.callFunction.mockResolvedValue(envelope(0, 'ok', { roomId: 'r_1' }))
    await expect(call('room', 'create', { name: '周五场' })).resolves.toEqual({ roomId: 'r_1' })
  })

  test('成功且 data 为 null 时返回 null', async () => {
    wx.cloud.callFunction.mockResolvedValue(envelope(0, 'ok', null))
    await expect(call('entry', 'list', {})).resolves.toBeNull()
  })

  test('请求参数包含 action、payload、requestId', async () => {
    wx.cloud.callFunction.mockResolvedValue(envelope(0, 'ok', null))
    await call('entry', 'add', { roomId: 'r_1', amountCents: 500 })
    expect(wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'entry',
      data: { action: 'add', payload: { roomId: 'r_1', amountCents: 500 }, requestId: FIXED_ID }
    })
  })

  test('payload 省略时默认为空对象', async () => {
    wx.cloud.callFunction.mockResolvedValue(envelope(0, 'ok', null))
    await call('auth', 'login')
    const sent = wx.cloud.callFunction.mock.calls[0][0]
    expect(sent.data.payload).toEqual({})
  })

  test('显式传入 requestId 时不被覆盖', async () => {
    setRequestIdFactory(null) // 即使默认生成器在跑，也应使用显式值
    wx.cloud.callFunction.mockResolvedValue(envelope(0, 'ok', null))
    await call('room', 'create', { name: 'x' }, { requestId: 'my-explicit-id' })
    const sent = wx.cloud.callFunction.mock.calls[0][0]
    expect(sent.data.requestId).toBe('my-explicit-id')
  })

  test('默认 requestId 为 UUID v4 格式', async () => {
    setRequestIdFactory(null)
    wx.cloud.callFunction.mockResolvedValue(envelope(0, 'ok', null))
    await call('room', 'list', {})
    const sent = wx.cloud.callFunction.mock.calls[0][0]
    expect(sent.data.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  test('timeout 选项透传给 callFunction', async () => {
    wx.cloud.callFunction.mockResolvedValue(envelope(0, 'ok', null))
    await call('room', 'detail', { roomId: 'r_1' }, { timeout: 8000 })
    expect(wx.cloud.callFunction).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 8000 })
    )
  })
})

describe('call — 业务错误', () => {
  test('code !== 0 时抛 ApiError，字段正确', async () => {
    wx.cloud.callFunction.mockResolvedValue(envelope(2002, 'ROOM_ENDED', null))
    try {
      await call('entry', 'add', { roomId: 'r_1' })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect(e).toBeInstanceOf(Error)
      expect(e.name).toBe('ApiError')
      expect(e.code).toBe(2002)
      expect(e.message).toBe('ROOM_ENDED')
    }
  })

  test('失败响应携带的 data 字段被保留', async () => {
    wx.cloud.callFunction.mockResolvedValue(envelope(3004, 'INVALID_MEMBER', { bad: 'o_x' }))
    await expect(call('entry', 'add', {})).rejects.toEqual(
      expect.objectContaining({ code: 3004, data: { bad: 'o_x' } })
    )
  })
})

describe('call — 网络与协议异常', () => {
  test('callFunction 拒绝 -> NETWORK_ERROR 可读 ApiError', async () => {
    wx.cloud.callFunction.mockRejectedValue({ errMsg: 'request:fail timeout' })
    try {
      await call('room', 'list', {})
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect(e.code).toBe(NETWORK_ERROR_CODE)
      expect(e.message).toBe(NETWORK_ERROR_MESSAGE)
    }
  })

  test('云函数不存在 -> NETWORK_ERROR 且保留原始 errMsg', async () => {
    wx.cloud.callFunction.mockRejectedValue(new Error('cloud function not found'))
    try {
      await call('ghost', 'boo', {})
      throw new Error('should have thrown')
    } catch (e) {
      expect(e.code).toBe(NETWORK_ERROR_CODE)
      expect(e.cause).toContain('cloud function not found')
    }
  })

  test('响应缺失 code 字段 -> NETWORK_ERROR（协议异常）', async () => {
    wx.cloud.callFunction.mockResolvedValue({ result: { message: 'garbage' } })
    await expect(call('room', 'list', {})).rejects.toEqual(
      expect.objectContaining({ code: NETWORK_ERROR_CODE })
    )
  })

  test('响应整体缺失 -> NETWORK_ERROR', async () => {
    wx.cloud.callFunction.mockResolvedValue({})
    await expect(call('room', 'list', {})).rejects.toEqual(
      expect.objectContaining({ code: NETWORK_ERROR_CODE })
    )
  })
})

describe('call — v2.5 在途去重', () => {
  test('同名同动作同参数并发：只出网一次，结果共享', async () => {
    let resolve
    wx.cloud.callFunction.mockImplementation(() => new Promise((r) => { resolve = r }))
    const p1 = call('room', 'detail', { roomId: 'r_1' })
    const p2 = call('room', 'detail', { roomId: 'r_1' })
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    resolve(envelope(0, 'ok', { room: { roomId: 'r_1' } }))
    await expect(p1).resolves.toEqual({ room: { roomId: 'r_1' } })
    await expect(p2).resolves.toEqual({ room: { roomId: 'r_1' } })
  })

  test('payload 键序不同仍判同一请求', async () => {
    let resolve
    wx.cloud.callFunction.mockImplementation(() => new Promise((r) => { resolve = r }))
    const p1 = call('entry', 'list', { roomId: 'r_1', page: 0 })
    const p2 = call('entry', 'list', { page: 0, roomId: 'r_1' })
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    resolve(envelope(0, 'ok', { items: [] }))
    await Promise.all([p1, p2])
  })

  test('动作或参数不同 -> 各自独立出网', async () => {
    const resolvers = []
    wx.cloud.callFunction.mockImplementation(() => new Promise((r) => { resolvers.push(r) }))
    const p1 = call('room', 'detail', { roomId: 'r_1' })
    const p2 = call('room', 'detail', { roomId: 'r_2' })
    const p3 = call('room', 'list', { roomId: 'r_1' })
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(3)
    resolvers.forEach((r) => r(envelope(0, 'ok', null)))
    await Promise.all([p1, p2, p3])
  })

  test('落地即出表：前一次完成后同键请求重新出网', async () => {
    wx.cloud.callFunction.mockResolvedValue(envelope(0, 'ok', { items: [] }))
    await call('room', 'list', { page: 0 })
    await call('room', 'list', { page: 0 })
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(2)
  })

  test('requestId / timeout 属传输元数据，不参与判同', async () => {
    let resolve
    wx.cloud.callFunction.mockImplementation(() => new Promise((r) => { resolve = r }))
    const p1 = call('room', 'detail', { roomId: 'r_1' }, { requestId: 'x' })
    const p2 = call('room', 'detail', { roomId: 'r_1' }, { requestId: 'y', timeout: 3000 })
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    resolve(envelope(0, 'ok', null))
    await Promise.all([p1, p2])
  })

  test('在途失败：等待方共享同一 ApiError，失败后出表可重试', async () => {
    let reject
    wx.cloud.callFunction.mockImplementation(() => new Promise((_, rj) => { reject = rj }))
    const p1 = call('room', 'detail', { roomId: 'r_1' })
    const p2 = call('room', 'detail', { roomId: 'r_1' })
    reject({ errMsg: 'request:fail timeout' })
    const e1 = await p1.catch((e) => e)
    const e2 = await p2.catch((e) => e)
    expect(e1).toBeInstanceOf(ApiError)
    expect(e2).toBe(e1)
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)

    wx.cloud.callFunction.mockResolvedValue(envelope(0, 'ok', { ok: true }))
    await expect(call('room', 'detail', { roomId: 'r_1' })).resolves.toEqual({ ok: true })
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(2)
  })
})
