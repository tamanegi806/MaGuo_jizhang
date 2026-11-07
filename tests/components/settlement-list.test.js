/**
 * @jest-environment jsdom
 */
/**
 * settlement-list 组件测试 — CMP-05
 */
const { renderComponent } = require('../helpers/render-component')

const ITEMS = [
  { openid: 'o_a', nickname: '阿明', totalCents: 5000, isOwner: true },
  { openid: 'o_b', nickname: '小王', totalCents: -3000 },
  { openid: 'o_c', nickname: '张三', totalCents: 0 }
]

function amounts(el) {
  return el.querySelectorAll('.settlement-list__amount').map((n) => n.dom.textContent)
}

describe('settlement-list', () => {
  test('CMP-05 正/负/零展示带符号文本：+¥50.00 / -¥30.00 / ¥0.00', () => {
    const el = renderComponent('settlement-list', { items: ITEMS })
    expect(amounts(el)).toEqual(['+¥50.00', '-¥30.00', '¥0.00'])
  })

  test('CMP-05 正红/负绿/零灰通过独立 class 表达（符号在文本中）', () => {
    const el = renderComponent('settlement-list', { items: ITEMS })
    expect(el.querySelectorAll('.settlement-list__amount--plus')).toHaveLength(1)
    expect(el.querySelectorAll('.settlement-list__amount--minus')).toHaveLength(1)
    expect(el.querySelectorAll('.settlement-list__amount--zero')).toHaveLength(1)
  })

  test('一分边界：+1 -> +¥0.01，-1 -> -¥0.01', () => {
    const el = renderComponent('settlement-list', {
      items: [
        { openid: 'a', nickname: 'A', totalCents: 1 },
        { openid: 'b', nickname: 'B', totalCents: -1 }
      ]
    })
    expect(amounts(el)).toEqual(['+¥0.01', '-¥0.01'])
  })

  test('items 动态更新触发 observer 重算', () => {
    const el = renderComponent('settlement-list', { items: [] })
    expect(el.querySelector('.settlement-list__empty')).toBeTruthy()
    el.setData({ items: ITEMS })
    expect(amounts(el)).toEqual(['+¥50.00', '-¥30.00', '¥0.00'])
    el.setData({ items: [] })
    expect(el.querySelector('.settlement-list__empty')).toBeTruthy()
    expect(el.querySelectorAll('.settlement-list__amount')).toHaveLength(0)
  })

  test('空列表显示占位', () => {
    const el = renderComponent('settlement-list', { items: [] })
    expect(el.querySelector('.settlement-list__empty').dom.textContent).toContain('暂无')
  })

  test('房主标识展示', () => {
    const el = renderComponent('settlement-list', { items: ITEMS })
    const tags = el.querySelectorAll('.settlement-list__owner-tag')
    expect(tags).toHaveLength(1)
  })
})
