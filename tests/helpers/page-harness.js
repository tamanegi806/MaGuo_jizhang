/**
 * 页面测试辅助 — node 环境下捕获 Page() 配置并构造可测试实例
 * 用法（测试文件顶部）：
 *   jest.mock('../../miniprogram/services/room-service', () => ({ ...jest.fn() 工厂 }))
 *   global.wx = createWxMock(); global.getApp = ...
 *   const opts = loadPageOptions('../../miniprogram/pages/room/room')
 *   const inst = createInstance(opts); await inst.onLoad({ id: 'r_1' })
 */

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj === undefined ? null : obj))
}

/**
 * 加载页面文件并捕获 Page(options) 注册内容
 * @param {string} relPath 相对测试文件的 require 路径
 */
function loadPageOptions(relPath) {
  let captured = null
  const prev = global.Page
  global.Page = (opts) => {
    captured = opts
  }
  try {
    require(relPath)
  } finally {
    global.Page = prev
  }
  if (!captured) throw new Error(`Page options not captured: ${relPath}`)
  return captured
}

/**
 * 基于捕获的 options 构造独立页面实例（data 深拷贝、setData 浅合并）
 * @param {object} options
 */
function createInstance(options) {
  const inst = Object.assign({}, options)
  inst.data = deepClone(options.data || {})
  inst.setData = function setData(patch, cb) {
    Object.keys(patch).forEach((key) => {
      inst.data[key] = patch[key]
    })
    if (typeof cb === 'function') cb()
  }
  return inst
}

/** 每次新建的 wx API mock（jsdom/node 通用） */
function createWxMock() {
  return {
    navigateTo: jest.fn(),
    redirectTo: jest.fn(),
    navigateBack: jest.fn(),
    showToast: jest.fn(),
    showLoading: jest.fn(),
    hideLoading: jest.fn(),
    setClipboardData: jest.fn(),
    stopPullDownRefresh: jest.fn(),
    // 默认确认；测试可覆盖
    showModal: jest.fn((opts) => {
      if (opts && typeof opts.success === 'function') opts.success({ confirm: true, cancel: false })
    })
  }
}

/** 冲刷微任务队列（setImmediate 不被 fake timers 拦截） */
function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve))
}

/** 可复用的 globalData 构造 getApp mock */
function mockGetApp(globalData) {
  global.getApp = jest.fn(() => ({ globalData }))
  return globalData
}

module.exports = { loadPageOptions, createInstance, createWxMock, flushPromises, mockGetApp }
