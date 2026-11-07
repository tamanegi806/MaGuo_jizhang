/**
 * 组件测试辅助 — miniprogram-simulate 渲染并挂载
 * 供 tests/components/*.test.js 使用（jsdom 环境）。
 */

const path = require('path')
const simulate = require('miniprogram-simulate')

// 每个组件只允许 load 一次（重复 load 会使 render 返回 undefined）
const idCache = new Map()

function loadComponent(name) {
  if (!idCache.has(name)) {
    const file = path.join(__dirname, '../../miniprogram/components', name, name)
    idCache.set(name, simulate.load(file))
  }
  return idCache.get(name)
}

/**
 * 渲染组件（自动 attach 到 parent-wrapper），每个测试用例独立实例
 * @param {string} name 组件目录/文件基名，如 'amount-input'
 * @param {object} [props] 初始 properties
 */
function renderComponent(name, props = {}) {
  const el = simulate.render(loadComponent(name), props)
  el.attach(document.createElement('parent-wrapper'))
  return el
}

module.exports = { renderComponent, listen, detailOf, simulate }

/**
 * 监听 host 自定义事件，返回 jest.fn 与最近一次 detail
 * @param {object} el
 * @param {string} eventName
 */
function listen(el, eventName) {
  const spy = jest.fn()
  el.addEventListener(eventName, spy)
  return spy
}

/** 从 spy 第 n 次调用取 detail */
function detailOf(spy, index = 0) {
  const call = spy.mock.calls[index]
  if (!call) return undefined
  const evt = call[0]
  return evt && evt.detail
}

module.exports = { renderComponent, listen, detailOf, simulate }
