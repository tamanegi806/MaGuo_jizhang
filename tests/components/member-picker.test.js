/**
 * @jest-environment jsdom
 */
/**
 * member-picker 组件测试 — CMP-03 / CMP-04
 */
const { renderComponent, listen, detailOf, simulate } = require('../helpers/render-component')

const MEMBERS = [
  { openid: 'o_a', nickname: '阿明', avatarFileID: 'cloud://a.png', isOwner: true },
  { openid: 'o_b', nickname: '小王', avatarFileID: '' },
  { openid: 'o_c', nickname: '张三丰', avatarFileID: 'cloud://c.png' }
]

function names(el) {
  return el.querySelectorAll('.member-picker__name').map((n) => n.dom.textContent)
}

describe('member-picker', () => {
  test('CMP-03 点击成员 -> change({ openid })', async () => {
    const el = renderComponent('member-picker', { members: MEMBERS })
    const change = listen(el, 'change')
    const items = el.querySelectorAll('.member-picker__item')
    expect(items).toHaveLength(3)

    items[1].dispatchEvent('tap')
    await simulate.sleep(0)
    expect(detailOf(change)).toEqual({ openid: 'o_b' })
  })

  test('CMP-04 excludeOpenid 时选项排除该成员（收款人排除付款人）', async () => {
    const el = renderComponent('member-picker', { members: MEMBERS, excludeOpenid: 'o_a' })
    expect(names(el)).toEqual(['小王', '张三丰'])

    const change = listen(el, 'change')
    el.querySelectorAll('.member-picker__item')[0].dispatchEvent('tap')
    await simulate.sleep(0)
    expect(detailOf(change)).toEqual({ openid: 'o_b' })

    // 动态变更：再次排除 o_b
    el.setData({ excludeOpenid: 'o_b' })
    expect(names(el)).toEqual(['阿明', '张三丰'])
  })

  test('展示房主标识', () => {
    const el = renderComponent('member-picker', { members: MEMBERS })
    const tags = el.querySelectorAll('.member-picker__owner-tag')
    expect(tags).toHaveLength(1)
    expect(tags[0].dom.textContent).toBe('房主')
  })

  test('valueOpenid 选中项带文本符号 ✓（不仅靠颜色）', () => {
    const el = renderComponent('member-picker', { members: MEMBERS, valueOpenid: 'o_c' })
    const checks = el.querySelectorAll('.member-picker__check')
    expect(checks).toHaveLength(1)
    expect(checks[0].dom.textContent).toBe('✓')
    expect(el.querySelectorAll('.member-picker__item--selected')).toHaveLength(1)
  })

  test('label 属性显示', () => {
    const el = renderComponent('member-picker', { members: MEMBERS, label: '选择收款人' })
    expect(el.querySelector('.member-picker__label').dom.textContent).toBe('选择收款人')
  })

  test('空成员列表显示占位', () => {
    const el = renderComponent('member-picker', { members: [] })
    expect(el.querySelector('.member-picker__empty')).toBeTruthy()
    expect(el.querySelectorAll('.member-picker__item')).toHaveLength(0)
  })

  test('全员被排除时仍显示占位', () => {
    const el = renderComponent('member-picker', { members: [MEMBERS[0]], excludeOpenid: 'o_a' })
    expect(el.querySelector('.member-picker__empty')).toBeTruthy()
  })

  test('长昵称截断', () => {
    const el = renderComponent('member-picker', {
      members: [{ openid: 'o_long', nickname: '东方无敌大魔王阿巴阿巴' }]
    })
    const name = el.querySelector('.member-picker__name').dom.textContent
    expect(name).toHaveLength(10)
    expect(name.endsWith('…')).toBe(true)
  })

  test('无昵称时回退 openid 展示', () => {
    const el = renderComponent('member-picker', { members: [{ openid: 'o_noname' }] })
    expect(el.querySelector('.member-picker__name').dom.textContent).toContain('o_noname')
  })
})
