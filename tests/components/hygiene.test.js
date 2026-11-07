/**
 * 组件通用要求核查（11-components「组件通用要求」）
 * - 不直接调用 wx.cloud.callFunction / wx.cloud.*
 * - 不持有全局状态（不 getApp、不模块级可变状态）
 * - 金额/符号不仅靠颜色：settlement-list / entry-card 的展示文本必含符号或 ¥
 * - 可点组件的 wxss 声明 ≥44px（96rpx）点击区域
 */
const fs = require('fs')
const path = require('path')

const COMPONENTS = [
  'amount-input',
  'member-picker',
  'settlement-list',
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
    for (const name of ['amount-input', 'member-picker', 'invite-sheet', 'state-view']) {
      const wxss = readIf(path.join(dirOf(name), `${name}.wxss`))
      expect(typeof wxss).toBe('string')
      expect(wxss).toMatch(/96rpx/)
    }
  })

  test('符号不仅靠颜色：结算/流水的文本自带 +/− 或 ¥', () => {
    const settlement = readIf(path.join(dirOf('settlement-list'), 'settlement-list.js'))
    expect(settlement).toMatch(/sign:\s*'always'/)
    const entry = readIf(path.join(dirOf('entry-card'), 'entry-card.js'))
    expect(entry).toMatch(/currency:\s*true/)
  })
})
