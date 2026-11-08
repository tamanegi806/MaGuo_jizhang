/**
 * v2.7 隐私授权层测试 — 降级、在途共享、会话缓存、指引入口
 */

const privacy = require('../../miniprogram/utils/privacy')

let wx

beforeEach(() => {
  privacy.resetSession() // 模块级会话状态须用例间隔离
  wx = {
    requirePrivacyAuthorize: jest.fn(),
    openPrivacyContract: jest.fn()
  }
  global.wx = wx
})

/** 让 requirePrivacyAuthorize 立即走某个回调 */
function stubAuthorize(outcome) {
  wx.requirePrivacyAuthorize = jest.fn(({ success, fail }) => {
    if (outcome === 'ok') success()
    else fail(new Error('user denied'))
  })
}

/** 让 requirePrivacyAuthorize 挂起，返回它的回调句柄（测在途共享） */
function pendingAuthorize() {
  const hooks = {}
  wx.requirePrivacyAuthorize = jest.fn((opts) => {
    hooks.success = opts.success
    hooks.fail = opts.fail
  })
  return hooks
}

describe('utils/privacy', () => {
  test('基础库不支持隐私接口 -> 视为已同意（不改变老版本行为）', async () => {
    delete wx.requirePrivacyAuthorize
    const res = await privacy.ensurePrivacy()
    expect(res).toEqual({ ok: true, error: null })
  })

  test('同意 -> ok:true', async () => {
    stubAuthorize('ok')
    await expect(privacy.ensurePrivacy()).resolves.toEqual({ ok: true, error: null })
    expect(wx.requirePrivacyAuthorize).toHaveBeenCalledTimes(1)
  })

  test('拒绝 -> ok:false 且带可展示文案（不 reject）', async () => {
    stubAuthorize('deny')
    const res = await privacy.ensurePrivacy()
    expect(res.ok).toBe(false)
    expect(res.error).toEqual({ code: 'PRIVACY', message: '需要同意隐私保护指引后才能继续' })
  })

  test('接口本身抛异常 -> 按未同意处理（宁可少采集，不可违规采集）', async () => {
    wx.requirePrivacyAuthorize = jest.fn(() => {
      throw new Error('boom')
    })
    await expect(privacy.ensurePrivacy()).resolves.toEqual({
      ok: false,
      error: { code: 'PRIVACY', message: '需要同意隐私保护指引后才能继续' }
    })
    expect(privacy.isConsented()).toBe(false)
  })

  test('超时兜底：弹窗既不回 success 也不回 fail 时不能永久挂住在途', async () => {
    jest.useFakeTimers()
    try {
      wx.requirePrivacyAuthorize = jest.fn(() => {}) // 扣住不回：模拟弹窗被系统回收/切后台被杀
      const p = privacy.ensurePrivacy()
      jest.advanceTimersByTime(privacy.AWAIT_TIMEOUT_MS)
      await expect(p).resolves.toEqual({ ok: false, error: privacy.TIMED_OUT })

      // 在途必须已放开，否则「保存并进入」会永久卡在 submitting（只能杀小程序重来）
      wx.requirePrivacyAuthorize = jest.fn(({ success }) => success())
      await expect(privacy.ensurePrivacy()).resolves.toEqual({ ok: true, error: null })
      expect(wx.requirePrivacyAuthorize).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  test('超时之后真回调才到达（用户在旧弹窗上点了同意）-> 会话结果改记为已同意', async () => {
    jest.useFakeTimers()
    try {
      const hooks = {}
      wx.requirePrivacyAuthorize = jest.fn((opts) => { hooks.success = opts.success })
      const p = privacy.ensurePrivacy()
      jest.advanceTimersByTime(privacy.AWAIT_TIMEOUT_MS)
      await p
      expect(privacy.isConsented()).toBe(false)

      hooks.success() // 迟到的真实同意：以真实结果为准，别把用户已经同意的事记成拒绝
      expect(privacy.isConsented()).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  test('真回调恰好在超时那一拍抢先到达 -> 会话结果仍记为已同意', async () => {
    jest.useFakeTimers()
    try {
      const hooks = {}
      wx.requirePrivacyAuthorize = jest.fn((opts) => { hooks.success = opts.success })
      const p = privacy.ensurePrivacy()
      jest.advanceTimersByTime(privacy.AWAIT_TIMEOUT_MS) // 超时先 resolve，.then 还在微任务队列里
      hooks.success() // 同一拍内用户点了同意：真回调先落地
      await p
      expect(privacy.isConsented()).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  test('在途共享：未决期间并发调用只弹一次窗，结果一致', async () => {
    const hooks = pendingAuthorize()
    const a = privacy.ensurePrivacy()
    const b = privacy.ensurePrivacy() // 首页 onShow 与资料页 onLoad 紧挨着发生
    expect(wx.requirePrivacyAuthorize).toHaveBeenCalledTimes(1)

    hooks.success()
    const [ra, rb] = await Promise.all([a, b])
    expect(ra).toEqual({ ok: true, error: null })
    expect(rb).toEqual(ra)
  })

  test('ensurePrivacyOnce：会话内第二次不再打扰，直接复用上次结果', async () => {
    stubAuthorize('deny')
    const first = await privacy.ensurePrivacyOnce()
    const second = await privacy.ensurePrivacyOnce()
    expect(first.ok).toBe(false)
    expect(second.ok).toBe(false)
    expect(wx.requirePrivacyAuthorize).toHaveBeenCalledTimes(1)
  })

  test('ensurePrivacy（真问）会刷新会话结果，Once 随后即复用', async () => {
    stubAuthorize('deny')
    await privacy.ensurePrivacyOnce()
    expect(privacy.isConsented()).toBe(false)

    stubAuthorize('ok')
    await privacy.ensurePrivacy() // 用户在资料页主动再同意一次
    expect(privacy.isConsented()).toBe(true)

    const before = wx.requirePrivacyAuthorize.mock.calls.length
    await privacy.ensurePrivacyOnce()
    expect(wx.requirePrivacyAuthorize).toHaveBeenCalledTimes(before) // 不再弹窗
  })

  test('resetSession 后重新询问（对应小程序被杀重开）', async () => {
    stubAuthorize('ok')
    await privacy.ensurePrivacyOnce()
    privacy.resetSession()
    await privacy.ensurePrivacyOnce()
    expect(wx.requirePrivacyAuthorize).toHaveBeenCalledTimes(2)
  })

  describe('openPrivacyContract', () => {
    test('支持且成功 -> true', async () => {
      wx.openPrivacyContract = jest.fn(({ success }) => success())
      await expect(privacy.openPrivacyContract()).resolves.toBe(true)
    })

    test('失败 -> false（由调用方兜底提示）', async () => {
      wx.openPrivacyContract = jest.fn(({ fail }) => fail(new Error('nope')))
      await expect(privacy.openPrivacyContract()).resolves.toBe(false)
    })

    test('老基础库没有该接口 -> false', async () => {
      delete wx.openPrivacyContract
      await expect(privacy.openPrivacyContract()).resolves.toBe(false)
    })
  })
})
