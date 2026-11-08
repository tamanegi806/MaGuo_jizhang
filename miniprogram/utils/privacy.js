/**
 * v2.7 隐私授权统一入口（详细设计 6.2.6 / 9.2）
 * 为什么要有这一层：
 * - **弹窗时机前置**：原实现只在「点保存」时问一次，用户填完昵称头像才被拦；现在进首页/资料页就先过一次。
 * - **在途共享**：`requirePrivacyAuthorize` 在未决期间被重复调用会排队出多个弹窗（首页 onShow 与
 *   资料页 onLoad 紧挨着发生），故同一次未决调用共享同一个 Promise——与 api-client 的在途去重同理。
 * - **会话内只打扰一次**：`ensurePrivacyOnce` 缓存最近一次结果；用户拒绝后不在首页反复弹，
 *   等他主动进资料页（那时才是真意图）再问。
 * - **不阻断无关功能**：拒绝只影响头像与昵称的采集，牌局列表、记账、结算都不依赖它——
 *   这是微信「用户拒绝授权后不得拒绝提供其他服务」的要求，所以调用方一律不 await 首页那一发。
 * 基础库不支持该接口时视为已同意，行为与本层引入前一致。
 */

/** 拒绝授权的对外错误结构（与资料页既有文案保持一致） */
const DENIED = { code: 'PRIVACY', message: '需要同意隐私保护指引后才能继续' }

/** 超时兜底结构：见 AWAIT_TIMEOUT_MS 注释 */
const TIMED_OUT = { code: 'PRIVACY', message: '隐私授权未完成，请重试' }

/**
 * 弹窗最长等待：60 秒（够读完弹窗），超时按「未同意」返回并放开在途。
 * 必须有这一道：弹窗被系统回收、用户切后台被杀等场景下 `requirePrivacyAuthorize` 可能既不回
 * success 也不回 fail，而 `pending` 是**模块级**的——不落地就会让之后每一次 await 永久挂住，
 * 表现为「保存并进入」按钮卡在 submitting 状态、只能杀掉小程序重来。
 */
const AWAIT_TIMEOUT_MS = 60 * 1000

/** 未决的授权请求（在途共享用） */
let pending = null

/** 本会话最近一次授权结果；null 表示还没问过 */
let settled = null

/**
 * 当前基础库是否支持隐私授权接口
 * @returns {boolean}
 */
function isSupported() {
  return typeof wx !== 'undefined' && typeof wx.requirePrivacyAuthorize === 'function'
}

/**
 * 请求隐私授权（每次都真问，用于用户意图明确的场合：进资料页、点头像、点保存）
 * @returns {Promise<{ok: boolean, error: object}>} 不会 reject，拒绝/异常也走 resolve
 */
function ensurePrivacy() {
  if (pending) return pending

  if (!isSupported()) {
    settled = { ok: true, error: null }
    return Promise.resolve(settled)
  }

  let timer = null
  let answered = false // 微信真回调是否已落地（含「恰好在超时那一拍抢先到达」的情形）

  pending = new Promise((resolve) => {
    // 微信的真回调：即使晚于超时到达，也以真实结果为准（覆盖 settled），
    // 此时 Promise 已结算，resolve 是 no-op，不影响已在 await 的调用方拿到超时结果。
    const fromWx = (result) => {
      answered = true
      settled = result
      resolve(result)
    }
    timer = setTimeout(() => resolve({ ok: false, error: TIMED_OUT }), AWAIT_TIMEOUT_MS)
    try {
      wx.requirePrivacyAuthorize({
        success: () => fromWx({ ok: true, error: null }),
        fail: () => fromWx({ ok: false, error: DENIED })
      })
    } catch (_) {
      // 接口本身异常（极少见）按未同意处理：宁可少采集，不可违规采集
      fromWx({ ok: false, error: DENIED })
    }
  }).then((result) => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    pending = null
    // 真回调已抢先落地时不覆盖它：否则「恰好同一拍点了同意」会被记成超时拒绝
    if (!answered) settled = result
    return result
  })

  return pending
}

/**
 * 会话内只真问一次的授权检查（用于页面入口的「顺带触发」，如首页 onShow）
 * @returns {Promise<{ok: boolean, error: object}>}
 */
function ensurePrivacyOnce() {
  if (settled) return Promise.resolve(settled)
  return ensurePrivacy()
}

/**
 * 本会话内是否已取得授权（不问、只看上次结果）
 * 用于「已经同意过就别再弹一次，还没同意过才需要问」的场合。
 * @returns {boolean}
 */
function isConsented() {
  return Boolean(settled && settled.ok)
}

/**
 * 打开微信生成的《小程序用户隐私保护指引》正文
 * 后台「设置 → 服务内容声明」里填的内容就是这一页，无需自建协议页。
 * @returns {Promise<boolean>} 是否真的打开了（不支持或失败返回 false，由调用方兜底提示）
 */
function openPrivacyContract() {
  if (typeof wx !== 'undefined' && typeof wx.openPrivacyContract === 'function') {
    return new Promise((resolve) => {
      wx.openPrivacyContract({
        success: () => resolve(true),
        fail: () => resolve(false)
      })
    })
  }
  return Promise.resolve(false)
}

/** 清空会话状态 —— 测试接缝，也对应小程序被杀重开后的自然复位 */
function resetSession() {
  pending = null
  settled = null
}

module.exports = {
  ensurePrivacy,
  ensurePrivacyOnce,
  isConsented,
  isSupported,
  openPrivacyContract,
  resetSession,
  DENIED,
  TIMED_OUT,
  AWAIT_TIMEOUT_MS
}
