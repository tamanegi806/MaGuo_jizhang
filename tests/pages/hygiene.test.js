/**
 * 页面层核查（12-pages「页面通用要求」）
 * - 只注册当前 6 页，无教程/番数路由
 * - 页面不直接调用 wx.cloud / callFunction
 * - usingComponents 路径真实存在（组件四件套齐全）
 * - 页面 json 合法
 */
const fs = require('fs')
const path = require('path')

const PAGES = ['index', 'create', 'join', 'room', 'entry', 'profile']
const pagesDir = path.join(__dirname, '../../miniprogram/pages')
const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../../miniprogram/app.json'), 'utf8'))

const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null)

describe('pages hygiene', () => {
  test('app.json 仅注册 6 个当前页面', () => {
    expect(app.pages).toEqual([
      'pages/index/index',
      'pages/create/create',
      'pages/join/join',
      'pages/room/room',
      'pages/entry/entry',
      'pages/profile/profile'
    ])
  })

  test('无教程/番数计算器路由与引用', () => {
    const all = PAGES.map((p) => readIf(path.join(pagesDir, p, `${p}.js`)))
      .concat(PAGES.map((p) => readIf(path.join(pagesDir, p, `${p}.wxml`))))
      .join('\n')
    expect(all).not.toMatch(/tutorial|教程|fan-calculator|番数/)
    expect(JSON.stringify(app.pages)).not.toMatch(/tutorial|fan/)
  })

  test.each(PAGES)('%s 页面不直接调用云环境', (name) => {
    const js = readIf(path.join(pagesDir, name, `${name}.js`))
    // 匹配实际调用形式，排除注释中的说明性文字
    expect(js).not.toMatch(/wx\.cloud\.|callFunction\(|getApp\(\)\.cloud/)
  })

  test.each(PAGES)('%s json 合法且 usingComponents 路径存在', (name) => {
    const json = JSON.parse(readIf(path.join(pagesDir, name, `${name}.json`)))
    const using = json.usingComponents || {}
    for (const tag of Object.keys(using)) {
      const ref = using[tag]
      expect(typeof ref).toBe('string')
      expect(ref).toMatch(/^\//) // 应为绝对组件路径
      const base = path.join(__dirname, '../../miniprogram', ref)
      for (const ext of ['js', 'json', 'wxml', 'wxss']) {
        const file = `${base}.${ext}`
        expect(fs.existsSync(file)).toBe(true) // 缺少组件文件：${file}
        expect(fs.statSync(file).size).toBeGreaterThan(0)
      }
    }
  })

  test('页面均通过 services 层访问网络', () => {
    for (const name of PAGES) {
      const js = readIf(path.join(pagesDir, name, `${name}.js`))
      expect(typeof js).toBe('string')
      expect(js).toMatch(/services\/(room|entry|auth|invite)-service/)
    }
  })
})
