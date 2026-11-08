/**
 * @jest-environment jsdom
 */
/**
 * entry-sheet 组件测试 — v1.7 记账弹层（展示 + 事件契约；请求与幂等键在页面）
 * 注意：simulate 的事件派发为异步，dispatchEvent 后需 await simulate.sleep(0) 再断言。
 */
const { renderComponent, listen, detailOf, simulate } = require('../helpers/render-component')

function render(props = {}) {
  const el = renderComponent('entry-sheet', {
    visible: true,
    nickname: '小王',
    avatarFileID: 'cloud://b.png',
    ...props
  })
  const confirm = listen(el, 'confirm')
  const close = listen(el, 'close')
  return { el, confirm, close }
}

describe('entry-sheet', () => {
  test('隐藏态不渲染', () => {
    const el = renderComponent('entry-sheet', { visible: false, nickname: '小王' })
    expect(el.querySelector('.entry-sheet')).toBeFalsy()
  })

  test('标题含目标昵称与头像，金额输入框就绪', () => {
    const { el } = render()
    expect(el.querySelector('.entry-sheet__title').dom.textContent).toContain('小王')
    expect(el.querySelector('.entry-sheet__avatar')).toBeTruthy()
    expect(el.instance.selectComponent('#amountInput')).toBeTruthy()
  })

  test('金额未填 -> 确认不触发事件', async () => {
    const { el, confirm } = render()
    el.querySelector('.entry-sheet__submit').dispatchEvent('tap')
    await simulate.sleep(0)
    expect(confirm).not.toHaveBeenCalled()
  })

  test('金额变更后确认 -> confirm(detail.valueCents)', async () => {
    const { el, confirm } = render()
    el.instance.onAmountChange({ detail: { valueCents: 5050 } })
    el.querySelector('.entry-sheet__submit').dispatchEvent('tap')
    await simulate.sleep(0)
    expect(detailOf(confirm)).toEqual({ valueCents: 5050 })
  })

  test('子组件输入金额 -> 冒泡 change 进入内部状态', async () => {
    const { el } = render()
    const child = el.instance.selectComponent('#amountInput')
    child.onInput({ detail: { value: '50.5' } })
    await simulate.sleep(0)
    expect(el.instance.data.amountCents).toBe(5050)
  })

  test('提交中确认 -> 不重复触发事件', async () => {
    const { el, confirm } = render({ submitting: true })
    el.instance.onAmountChange({ detail: { valueCents: 100 } })
    el.querySelector('.entry-sheet__submit').dispatchEvent('tap')
    await simulate.sleep(0)
    expect(confirm).not.toHaveBeenCalled()
  })

  test('遮罩与 × 点击触发 close', async () => {
    const { el, close } = render()
    el.querySelector('.entry-sheet__mask').dispatchEvent('tap')
    await simulate.sleep(0)
    expect(close).toHaveBeenCalledTimes(1)
    el.querySelector('.entry-sheet__close').dispatchEvent('tap')
    await simulate.sleep(0)
    expect(close).toHaveBeenCalledTimes(2)
  })

  test('errorText 显示保存失败文案', () => {
    const { el } = render({ errorText: '网络异常，请检查连接' })
    expect(el.querySelector('.entry-sheet__error').dom.textContent).toBe('网络异常，请检查连接')
  })

  test('组件不引用 wx.cloud / getApp，不 require 非 shared 模块', () => {
    const src = require('fs').readFileSync(
      require.resolve('../../miniprogram/components/entry-sheet/entry-sheet.js'),
      'utf8'
    )
    expect(src).not.toMatch(/wx\.cloud|getApp\(/)
    expect(src).not.toMatch(/require\(/)
  })
})
