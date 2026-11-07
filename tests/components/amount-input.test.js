/**
 * @jest-environment jsdom
 */
/**
 * amount-input 组件测试 — CMP-01 / CMP-02
 */
const { renderComponent, listen, detailOf } = require('../helpers/render-component')

function render(props = {}) {
  const el = renderComponent('amount-input', props)
  const change = listen(el, 'change')
  return { el, change }
}

function errorTextOf(el) {
  const node = el.querySelector('.amount-input__error')
  return node ? node.dom.textContent : ''
}

describe('amount-input', () => {
  test('CMP-01 输入 50.5 -> change(5050)，无错误提示', () => {
    const { el, change } = render()
    el.instance.onInput({ detail: { value: '50.5' } })
    expect(detailOf(change)).toEqual({ valueCents: 5050 })
    expect(errorTextOf(el)).toBe('')
    expect(el.data.text).toBe('50.5')
  })

  test('CMP-01 补充：整数元 100 -> 10000 分', () => {
    const { el, change } = render()
    el.instance.onInput({ detail: { value: '100' } })
    expect(detailOf(change)).toEqual({ valueCents: 10000 })
  })

  test.each([
    ['0', '金额必须大于 0'],
    ['-50', '金额必须大于 0'],
    ['-0.5', '金额必须大于 0'],
    ['abc', '请输入正确的金额（最多两位小数）'],
    ['1.234', '请输入正确的金额（最多两位小数）'],
    ['200000000.01', '请输入正确的金额（最多两位小数）']
  ])('CMP-02 输入 %p -> 不触发 change 且显示错误', (raw, expected) => {
    const { el, change } = render()
    el.instance.onInput({ detail: { value: raw } })
    expect(change).not.toHaveBeenCalled()
    expect(errorTextOf(el)).toBe(expected)
  })

  test('清空输入：不触发 change，也不显示错误', () => {
    const { el, change } = render()
    el.instance.onInput({ detail: { value: '12.5' } })
    change.mockClear()
    el.instance.onInput({ detail: { value: '' } })
    expect(change).not.toHaveBeenCalled()
    expect(errorTextOf(el)).toBe('')
  })

  test('非法输入后的下一次合法输入恢复正常（错误清除并触发 change）', () => {
    const { el, change } = render()
    el.instance.onInput({ detail: { value: '-1' } })
    expect(change).not.toHaveBeenCalled()
    el.instance.onInput({ detail: { value: '0.5' } })
    expect(detailOf(change)).toEqual({ valueCents: 50 })
    expect(errorTextOf(el)).toBe('')
  })

  test('失焦合法输入：规范化文本并触发 change', () => {
    const { el, change } = render()
    el.instance.onBlur({ detail: { value: '50.5' } })
    expect(detailOf(change)).toEqual({ valueCents: 5050 })
    expect(el.data.text).toBe('50.50')
  })

  test('失焦非法输入：显示错误、不触发 change', () => {
    const { el, change } = render()
    el.instance.onBlur({ detail: { value: '-2' } })
    expect(change).not.toHaveBeenCalled()
    expect(errorTextOf(el)).toBe('金额必须大于 0')
  })

  test('value 回填：外部设置分（>0）显示为元', () => {
    const { el } = render({ value: 9900 })
    expect(el.data.text).toBe('99.00')
  })

  test('value 变更触发 observer 同步文本', () => {
    const { el } = render()
    el.setData({ value: 12345 })
    expect(el.data.text).toBe('123.45')
    el.setData({ value: 0 })
    expect(el.data.text).toBe('')
  })

  test('disabled 属性透传到样式与输入框', () => {
    const { el } = render({ disabled: true })
    expect(el.querySelector('.amount-input--disabled')).toBeTruthy()
  })

  test('placeholder 属性显示', () => {
    const { el } = render({ placeholder: '输金额' })
    expect(el.instance.data.placeholder).toBe('输金额')
  })

  test('组件不引用 wx.cloud / getApp', () => {
    const src = require('fs').readFileSync(
      require.resolve('../../miniprogram/components/amount-input/amount-input.js'),
      'utf8'
    )
    expect(src).not.toMatch(/wx\.cloud|getApp\(/)
  })
})
