/**
 * @jest-environment jsdom
 */
/**
 * invite-sheet 组件测试 — CMP-07
 */
const { renderComponent, listen, detailOf, simulate } = require('../helpers/render-component')

describe('invite-sheet', () => {
  test('visible=false 不渲染弹层', () => {
    const el = renderComponent('invite-sheet', { visible: false, inviteCode: '8234' })
    expect(el.querySelector('.invite-sheet')).toBeFalsy()
  })

  test('加载态：显示骨架，隐藏错误与图片', () => {
    const el = renderComponent('invite-sheet', {
      visible: true,
      inviteCode: '8234',
      qrLoading: true
    })
    expect(el.querySelector('.invite-sheet__skeleton')).toBeTruthy()
    expect(el.querySelector('.invite-sheet__qr-img')).toBeFalsy()
    expect(el.querySelector('.invite-sheet__retry')).toBeFalsy()
  })

  test('成功态：展示小程序码与邀请码', () => {
    const el = renderComponent('invite-sheet', {
      visible: true,
      inviteCode: '8234',
      qrFileID: 'cloud://env/qrcodes/r_1/release.png'
    })
    expect(el.querySelector('.invite-sheet__qr-img')).toBeTruthy()
    expect(el.querySelector('.invite-sheet__code').dom.textContent).toBe('8234')
    expect(el.querySelector('.invite-sheet__retry')).toBeFalsy()
  })

  test('CMP-07 加载失败：显示重试，邀请码仍可复制', async () => {
    const el = renderComponent('invite-sheet', {
      visible: true,
      inviteCode: '8234',
      qrError: '小程序码生成失败'
    })
    expect(el.querySelector('.invite-sheet__retry')).toBeTruthy()
    expect(el.querySelector('.invite-sheet__qr-error-text').dom.textContent).toContain('小程序码生成失败')

    const copy = listen(el, 'copyCode')
    el.querySelector('.invite-sheet__copy').dispatchEvent('tap')
    await simulate.sleep(0)
    expect(detailOf(copy)).toEqual({ code: '8234' })
  })

  test('CMP-07 失败态点击重试 -> retry 事件', async () => {
    const el = renderComponent('invite-sheet', { visible: true, inviteCode: '8234', qrError: 'x' })
    const retry = listen(el, 'retry')
    el.querySelector('.invite-sheet__retry').dispatchEvent('tap')
    await simulate.sleep(0)
    expect(retry).toHaveBeenCalledTimes(1)
  })

  test('qrError 清除后恢复默认错误文案并可回到成功态', () => {
    const el = renderComponent('invite-sheet', { visible: true, inviteCode: '8234' })
    // 初始无 fileID 非 loading -> 错误分支（默认文案）
    expect(el.querySelector('.invite-sheet__qr-error-text').dom.textContent).toContain('加载失败')
    el.setData({ qrFileID: 'cloud://ok.png' })
    expect(el.querySelector('.invite-sheet__qr-img')).toBeTruthy()
  })

  test('点击遮罩与关闭按钮均触发 close', async () => {
    const el = renderComponent('invite-sheet', { visible: true, inviteCode: '8234', qrFileID: 'c://x' })
    const close = listen(el, 'close')
    el.querySelector('.invite-sheet__mask').dispatchEvent('tap')
    await simulate.sleep(0)
    expect(close).toHaveBeenCalledTimes(1)
    el.querySelector('.invite-sheet__close').dispatchEvent('tap')
    await simulate.sleep(0)
    expect(close).toHaveBeenCalledTimes(2)
  })

  test('加载中也可复制邀请码（复制与二维码解耦）', async () => {
    const el = renderComponent('invite-sheet', { visible: true, inviteCode: 'B8N3P1', qrLoading: true })
    const copy = listen(el, 'copyCode')
    el.querySelector('.invite-sheet__copy').dispatchEvent('tap')
    await simulate.sleep(0)
    expect(detailOf(copy)).toEqual({ code: 'B8N3P1' })
  })

  test('转发按钮存在（open-type=share，转发由页面处理）', () => {
    const el = renderComponent('invite-sheet', { visible: true, inviteCode: '8234' })
    const share = el.querySelector('.invite-sheet__share')
    expect(share).toBeTruthy()
  })

  // ---------- v1.9 邀请卡 ----------

  test('邀请卡：牌局名 + 人数文案', () => {
    const el = renderComponent('invite-sheet', {
      visible: true,
      inviteCode: '8234',
      roomName: '周五夜场',
      memberCount: 4,
      members: [{ openid: 'o_a', avatarFileID: 'cloud://a.png' }]
    })
    expect(el.querySelector('.invite-card__name').dom.textContent).toBe('周五夜场')
    expect(el.querySelector('.invite-card__meta').dom.textContent).toContain('4 人已在牌局中')
    expect(el.querySelectorAll('.invite-card__face')).toHaveLength(1)
    expect(el.querySelector('.invite-card__more')).toBeFalsy()
  })

  test('邀请卡：无牌局名兜底「牌局」（一键创建不留名）', () => {
    const el = renderComponent('invite-sheet', { visible: true, inviteCode: '8234', memberCount: 2 })
    expect(el.querySelector('.invite-card__name').dom.textContent).toBe('牌局')
  })

  test('邀请卡：头像堆叠最多 5 个，其余计入 +N', () => {
    const members = Array.from({ length: 8 }, (_, i) => ({
      openid: `o_${i}`,
      avatarFileID: `cloud://a${i}.png`
    }))
    const el = renderComponent('invite-sheet', {
      visible: true,
      inviteCode: '8234',
      memberCount: 8,
      members
    })
    expect(el.querySelectorAll('.invite-card__face')).toHaveLength(5)
    expect(el.querySelector('.invite-card__more').dom.textContent).toBe('+3')
  })

  test('邀请卡：memberCount 大于成员列表时按大者计 +N', () => {
    const el = renderComponent('invite-sheet', {
      visible: true,
      inviteCode: '8234',
      memberCount: 7,
      members: [{ openid: 'o_a' }, { openid: 'o_b' }]
    })
    expect(el.querySelector('.invite-card__more').dom.textContent).toBe('+2')
  })

  test('邀请卡：无成员数据不崩，堆叠为空', () => {
    const el = renderComponent('invite-sheet', { visible: true, inviteCode: '8234' })
    expect(el.querySelectorAll('.invite-card__face')).toHaveLength(0)
    expect(el.querySelector('.invite-card__more')).toBeFalsy()
  })
})
