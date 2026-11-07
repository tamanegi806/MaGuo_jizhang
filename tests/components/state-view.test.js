/**
 * @jest-environment jsdom
 */
/**
 * state-view 组件测试 — 加载/空/错误三态 + retry 事件
 */
const { renderComponent, listen, simulate } = require('../helpers/render-component')

describe('state-view', () => {
  test('loading 态：spinner 与默认文案', () => {
    const el = renderComponent('state-view', { type: 'loading' })
    expect(el.querySelector('.state-view__spinner')).toBeTruthy()
    expect(el.querySelector('.state-view__text').dom.textContent).toBe('加载中…')
    expect(el.querySelector('.state-view__retry')).toBeFalsy()
  })

  test('empty 态：占位图标与默认文案，无重试', () => {
    const el = renderComponent('state-view', { type: 'empty' })
    expect(el.querySelector('.state-view__empty')).toBeTruthy()
    expect(el.querySelector('.state-view__text').dom.textContent).toBe('暂无数据')
    expect(el.querySelector('.state-view__retry')).toBeFalsy()
  })

  test('error 态：默认文案 + 重试入口', () => {
    const el = renderComponent('state-view', { type: 'error' })
    expect(el.querySelector('.state-view__error')).toBeTruthy()
    expect(el.querySelector('.state-view__text').dom.textContent).toBe('加载失败，请重试')
    expect(el.querySelector('.state-view__retry').dom.textContent).toBe('重试')
  })

  test('text 属性覆盖默认文案', () => {
    const el = renderComponent('state-view', { type: 'error', text: '网络异常，请稍后再试' })
    expect(el.querySelector('.state-view__text').dom.textContent).toBe('网络异常，请稍后再试')
  })

  test('点击重试触发 retry 事件', async () => {
    const el = renderComponent('state-view', { type: 'error' })
    const retry = listen(el, 'retry')
    el.querySelector('.state-view__retry').dispatchEvent('tap')
    await simulate.sleep(0)
    expect(retry).toHaveBeenCalledTimes(1)
  })

  test('type 动态切换时文案跟随（props 变化）', () => {
    const el = renderComponent('state-view', { type: 'loading' })
    el.setData({ type: 'empty' })
    expect(el.querySelector('.state-view__text').dom.textContent).toBe('暂无数据')
    el.setData({ type: 'error' })
    expect(el.querySelector('.state-view__retry')).toBeTruthy()
  })

  test('未知 type 回退为空态', () => {
    const el = renderComponent('state-view', { type: 'weird' })
    expect(el.querySelector('.state-view__text').dom.textContent).toBe('暂无数据')
  })
})
