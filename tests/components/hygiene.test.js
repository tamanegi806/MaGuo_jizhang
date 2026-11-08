/**
 * 组件通用要求核查（11-components「组件通用要求」）
 * - 不直接调用 wx.cloud.callFunction / wx.cloud.*
 * - 不持有全局状态（不 getApp、不模块级可变状态）
 * - 金额/符号不仅靠颜色：entry-card 的展示文本必含 ¥，净额盈亏（详情页头像下方，v2.0 起结算统计模块移除）符号显式
 * - 可点组件的 wxss 声明 ≥44px（96rpx）点击区域
 */
const fs = require('fs')
const path = require('path')

const COMPONENTS = [
  'amount-input',
  'entry-sheet',
  'entry-card',
  'invite-sheet',
  'state-view'
]

const dirOf = (name) => path.join(__dirname, '../../miniprogram/components', name)
const readIf = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null)

describe('组件通用要求', () => {
  test.each(COMPONENTS)('%s 四件套齐全且注册 Component', (name) => {
    for (const ext of ['js', 'json', 'wxml', 'wxss']) {
      const content = readIf(path.join(dirOf(name), `${name}.${ext}`))
      expect(content).not.toBeNull()
      expect((content || '').trim().length).toBeGreaterThan(0)
    }
    const js = readIf(path.join(dirOf(name), `${name}.js`))
    expect(js).toMatch(/Component\(/)
    const json = JSON.parse(readIf(path.join(dirOf(name), `${name}.json`)))
    expect(json.component).toBe(true)
  })

  test.each(COMPONENTS)('%s 不访问云环境与全局状态', (name) => {
    const js = readIf(path.join(dirOf(name), `${name}.js`))
    expect(js).not.toMatch(/wx\.cloud|getApp\(/)
    // require 仅允许 shared 纯函数模块
    const requires = js.match(/require\(([^)]+)\)/g) || []
    for (const req of requires) {
      expect(req).toMatch(/\.\.\/\.\.\/shared\/|^\(.*render-component.*\)$/)
    }
  })

  test('点击区域样式：可交互组件 wxss 含 ≥44px 声明', () => {
    for (const name of ['amount-input', 'entry-sheet', 'invite-sheet', 'state-view']) {
      const wxss = readIf(path.join(dirOf(name), `${name}.wxss`))
      expect(typeof wxss).toBe('string')
      expect(wxss).toMatch(/96rpx/)
    }
  })

  test('v2.2 记账弹层上半部悬浮卡片：距顶留边、左右留边、四角圆角、柔影，不贴底', () => {
    const wxss = readIf(path.join(dirOf('entry-sheet'), 'entry-sheet.wxss'))
    const panel = wxss.match(/\.entry-sheet__panel\s*\{[^}]*\}/)
    expect(panel).toBeTruthy()
    expect(panel[0]).toMatch(/top:\s*calc\(/) // 距顶 120rpx + 安全区
    expect(panel[0]).toMatch(/left:\s*40rpx/) // 左右留边（悬浮而非通栏）
    expect(panel[0]).toMatch(/border-radius:\s*var\(--radius-card\)/) // 四角圆角
    expect(panel[0]).toMatch(/box-shadow/) // 下缘柔影分层
    expect(panel[0]).not.toMatch(/bottom:\s*0/)
    // 邀请弹层不受这两版影响，仍为底部弹层
    const invite = readIf(path.join(dirOf('invite-sheet'), 'invite-sheet.wxss'))
    const invitePanel = invite.match(/\.invite-sheet__panel\s*\{[^}]*\}/)
    expect(invitePanel[0]).toMatch(/bottom:\s*0/)
  })

  test('符号不仅靠颜色：流水文本含 ¥，头像盈亏符号显式（v2.0 结算统计移除后）', () => {
    const entry = readIf(path.join(dirOf('entry-card'), 'entry-card.js'))
    expect(entry).toMatch(/currency:\s*true/)
    const room = readIf(path.join(__dirname, '../../miniprogram/pages/room/room.js'))
    expect(room).toMatch(/sign:\s*'always'/)
    // v2.0：结算统计模块与 settlement-list 组件已移除（注释允许提及，渲染与注册不允许）
    const roomWxml = readIf(path.join(__dirname, '../../miniprogram/pages/room/room.wxml'))
    expect(roomWxml).not.toMatch(/<settlement-list/)
    expect(roomWxml).not.toMatch(/class="section-label"[^>]*>\s*结算统计/)
    const roomJson = readIf(path.join(__dirname, '../../miniprogram/pages/room/room.json'))
    expect(roomJson).not.toMatch(/settlement-list/)
  })

  test('v2.3 流水行低调化：金额中性色无红、无 600 粗（红绿语义仅在成员盈亏）', () => {
    const wxss = readIf(path.join(dirOf('entry-card'), 'entry-card.wxss'))
    const amount = wxss.match(/\.entry-card__amount\s*\{[^}]*\}/)[0]
    expect(amount).toMatch(/color:\s*var\(--color-text\)/)
    expect(amount).not.toMatch(/--color-danger/)
    expect(amount).not.toMatch(/font-weight:\s*600/)
    expect(wxss).not.toMatch(/--color-danger/)
  })
})
