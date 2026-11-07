/**
 * @jest-environment jsdom
 */
/**
 * entry-card 组件测试 — CMP-06
 */
const { renderComponent, listen, detailOf, simulate } = require('../helpers/render-component')

const TS = new Date(2026, 10, 7, 21, 30, 0).getTime()

const ENTRY = {
  entryId: 'e_001',
  roomId: 'r_001',
  fromOpenid: 'o_a',
  fromNickname: '阿明',
  toOpenid: 'o_b',
  toNickname: '小王',
  amountCents: 5000,
  amountText: '¥50.00',
  createdBy: 'o_a',
  createdAt: TS
}

describe('entry-card', () => {
  test('CMP-06 渲染付款人 → 收款人、金额、时间', () => {
    const el = renderComponent('entry-card', { entry: ENTRY })
    expect(el.querySelector('.entry-card__from').dom.textContent).toBe('阿明')
    expect(el.querySelector('.entry-card__arrow').dom.textContent).toBe('→')
    expect(el.querySelector('.entry-card__to').dom.textContent).toBe('小王')
    expect(el.querySelector('.entry-card__amount').dom.textContent).toBe('¥50.00')
    expect(el.querySelector('.entry-card__time').dom.textContent).toBe('11-07 21:30')
  })

  test('无 amountText 时用 amountCents 复用 shared/money 格式化', () => {
    const el = renderComponent('entry-card', {
      entry: { ...ENTRY, amountText: '', amountCents: 12345 }
    })
    expect(el.querySelector('.entry-card__amount').dom.textContent).toBe('¥123.45')
  })

  test('长昵称截断（保留可读前缀 + 省略号）', () => {
    const el = renderComponent('entry-card', {
      entry: { ...ENTRY, fromNickname: '东方无敌大魔王阿巴阿巴' }
    })
    const from = el.querySelector('.entry-card__from').dom.textContent
    expect(from).toHaveLength(8)
    expect(from.endsWith('…')).toBe(true)
  })

  test('CMP-06 点击卡片触发 tap 事件并携带 entry', async () => {
    const el = renderComponent('entry-card', { entry: ENTRY })
    const tap = listen(el, 'tap')
    el.querySelector('.entry-card').dispatchEvent('tap')
    await simulate.sleep(0)
    expect(tap).toHaveBeenCalledTimes(1)
    expect(detailOf(tap).entry).toMatchObject({ entryId: 'e_001' })
  })

  test('点击卡片内部区域同样冒泡到 tap', async () => {
    const el = renderComponent('entry-card', { entry: ENTRY })
    const tap = listen(el, 'tap')
    el.querySelector('.entry-card__main').dispatchEvent('tap')
    await simulate.sleep(0)
    expect(tap).toHaveBeenCalledTimes(1)
  })

  test('entry 动态更新触发 observer 重算', () => {
    const el = renderComponent('entry-card', { entry: ENTRY })
    el.setData({ entry: { ...ENTRY, toNickname: '赵四', amountText: '¥88.80' } })
    expect(el.querySelector('.entry-card__to').dom.textContent).toBe('赵四')
    expect(el.querySelector('.entry-card__amount').dom.textContent).toBe('¥88.80')
  })

  test('无效时间不展示时间行', () => {
    const el = renderComponent('entry-card', { entry: { ...ENTRY, createdAt: 0 } })
    expect(el.querySelector('.entry-card__time')).toBeFalsy()
  })

  test('昵称缺失回退 openid', () => {
    const el = renderComponent('entry-card', {
      entry: { ...ENTRY, fromNickname: '', toNickname: '' }
    })
    expect(el.querySelector('.entry-card__from').dom.textContent).toContain('o_a')
    expect(el.querySelector('.entry-card__to').dom.textContent).toContain('o_b')
  })
})
