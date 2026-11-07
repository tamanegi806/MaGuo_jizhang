/**
 * 云函数 dispatch 分发逻辑测试 — 契约见详细设计 4.1
 * event = { action, payload, requestId }；响应 = { code, message, data, requestId }
 */

const { ok, fail, dispatch } = require('../../cloudfunctions/_shared/response.js')
const { AppError, ErrorCodes } = require('../../shared/errors.js')

const ctx = { openid: 'o_test_openid_1', now: () => 1700000000000 }

describe('dispatch', () => {
  describe('成功路径', () => {
    test('按 action 分发并把 payload、ctx 传给处理器', async () => {
      const calls = []
      const handlers = {
        hello: async (payload, c) => {
          calls.push({ payload, ctx: c })
          return { result: 'world' }
        }
      }
      const res = await dispatch(
        { action: 'hello', payload: { x: 1 }, requestId: 'req-1' },
        handlers,
        ctx
      )
      expect(res).toEqual({ code: 0, message: 'ok', data: { result: 'world' }, requestId: 'req-1' })
      expect(calls[0].payload).toEqual({ x: 1 })
      expect(calls[0].ctx).toBe(ctx)
    })

    test('处理器返回 undefined 时 data 为 null', async () => {
      const res = await dispatch({ action: 'noop', payload: {}, requestId: 'r' }, { noop: async () => undefined }, ctx)
      expect(res.code).toBe(0)
      expect(res.data).toBeNull()
    })
  })

  describe('错误路径', () => {
    test('未知 action -> INVALID_PARAM(4001)', async () => {
      const res = await dispatch({ action: 'nope', payload: {}, requestId: 'r' }, {}, ctx)
      expect(res.code).toBe(ErrorCodes.INVALID_PARAM)
      expect(res.requestId).toBe('r')
    })

    test('AppError -> 对应业务错误码，message 保留', async () => {
      const handlers = { boom: async () => { throw new AppError(ErrorCodes.ROOM_ENDED, 'ROOM_ENDED') } }
      const res = await dispatch({ action: 'boom', payload: {}, requestId: 'r' }, handlers, ctx)
      expect(res.code).toBe(2002)
      expect(res.message).toBe('ROOM_ENDED')
      expect(res.data).toBeNull()
    })

    test('AppError 携带 data 时失败响应保留 data', async () => {
      const handlers = {
        bad: async () => { throw new AppError(ErrorCodes.INVALID_MEMBER, 'INVALID_MEMBER', { bad: 'o_x' }) }
      }
      const res = await dispatch({ action: 'bad', payload: {}, requestId: 'r' }, handlers, ctx)
      expect(res.code).toBe(3004)
      expect(res.data).toEqual({ bad: 'o_x' })
    })

    test('未捕获异常 -> INTERNAL_ERROR(5001)，不泄露堆栈', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const handlers = { crash: async () => { throw new Error('secret stack info') } }
      const res = await dispatch({ action: 'crash', payload: {}, requestId: 'r' }, handlers, ctx)
      expect(res.code).toBe(ErrorCodes.INTERNAL_ERROR)
      expect(res.message).not.toContain('secret')
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })

    test('event 缺失字段不崩溃', async () => {
      const res = await dispatch(undefined, undefined, ctx)
      expect(res.code).toBe(ErrorCodes.INVALID_PARAM)
    })
  })
})

describe('ok / fail 独立行为', () => {
  test('ok 构建 code=0 信封并回传 requestId', () => {
    expect(ok({ a: 1 }, 'r-9')).toEqual({ code: 0, message: 'ok', data: { a: 1 }, requestId: 'r-9' })
  })

  test('fail 对普通 Error 且无数字 code 时降级 5001', () => {
    const res = fail(new Error('plain'), 'r')
    expect(res.code).toBe(5001)
  })
})
