/**
 * 页面层核查（12-pages「页面通用要求」）
 * - 只注册当前 4 页，无教程/番数路由、无独立创建页、无独立记一笔页（v1.7）
 * - 页面不直接调用 wx.cloud / callFunction
 * - usingComponents 路径真实存在（组件四件套齐全）
 * - 页面 json 合法
 * - 邀请入口为成员队尾「＋」头像框，无旧邀请按钮（v1.8）
 */
const fs = require('fs')
const path = require('path')

const PAGES = ['index', 'join', 'room', 'profile']
const pagesDir = path.join(__dirname, '../../miniprogram/pages')
const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../../miniprogram/app.json'), 'utf8'))

const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null)

describe('pages hygiene', () => {
  test('app.json 仅注册 4 个当前页面（v1.4 移除 create 页；v1.7 移除 entry 页，记账改弹层）', () => {
    expect(app.pages).toEqual([
      'pages/index/index',
      'pages/join/join',
      'pages/room/room',
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

  test('记账只经由弹层：全工程无 pages/entry 引用（v1.7）', () => {
    const refs = PAGES.map((p) => readIf(path.join(pagesDir, p, `${p}.js`)))
      .concat(PAGES.map((p) => readIf(path.join(pagesDir, p, `${p}.wxml`))))
      .join('\n')
    expect(refs).not.toMatch(/pages\/entry/)
    expect(fs.existsSync(path.join(pagesDir, 'entry'))).toBe(false)
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

  test('牌局详情邀请入口为成员队尾「＋」头像框，旧邀请按钮已移除（v1.8）', () => {
    const wxml = readIf(path.join(pagesDir, 'room', 'room.wxml'))
    const wxss = readIf(path.join(pagesDir, 'room', 'room.wxss'))
    // 原「输赢记录」标题行按钮及其样式一并移除
    expect(wxml).not.toMatch(/section__invite/)
    expect(wxss).not.toMatch(/section__invite/)
    // 入口位于成员横向队列内、成员项之后，仅 canInvite 时出现，点击复用 tapInvite
    const members = wxml.match(/<scroll-view[\s\S]*?<\/scroll-view>/)[0]
    expect(members).toMatch(/wx:for="{{members}}"[\s\S]*members__item--add/)
    expect(members).toMatch(/wx:if="{{permissions.canInvite}}"[\s\S]*?bindtap="tapInvite"/)
    expect(members).toMatch(/members__add-avatar">＋/)
    // 空头像框：虚线圆框、尺寸与成员头像一致（88rpx ≈ 44px 可点区）
    expect(wxss).toMatch(/\.members__add-avatar\s*\{[^}]*border:\s*2rpx dashed[^}]*\}/)
    expect(wxss).toMatch(/\.members__add-avatar\s*\{[^}]*width:\s*88rpx[^}]*height:\s*88rpx/)
    // 与用户头像对齐：成员行为 flex 容器且项顶对齐（scroll-view 须开 enable-flex）
    expect(wxml).toMatch(/<scroll-view[^>]*class="members"[^>]*enable-flex/)
    expect(wxss).toMatch(/\.members\s*\{[^}]*display:\s*flex[^}]*align-items:\s*flex-start/)
    expect(wxss).toMatch(/\.members__item\s*\{[^}]*display:\s*flex/)
  })

  test('v2.3 详情页滚动分区：牌局头部/成员卡固定，仅输赢记录纵向滚动且触底分页', () => {
    const wxml = readIf(path.join(pagesDir, 'room', 'room.wxml'))
    const wxss = readIf(path.join(pagesDir, 'room', 'room.wxss'))
    const js = readIf(path.join(pagesDir, 'room', 'room.js'))
    // 整页不滚：100vh 纵向 flex + overflow hidden
    expect(wxss).toMatch(/\.room-page\s*\{[^}]*height:\s*100vh[^}]*overflow:\s*hidden/)
    // 唯一滚动区：scroll-y 包裹流水卡，flex:1 + min-height:0 允许收缩
    const entries = wxml.match(/<scroll-view[^>]*scroll-y[\s\S]*?<\/scroll-view>/)[0]
    expect(entries).toMatch(/class="entries-scroll"/)
    expect(entries).toMatch(/bindscrolltolower="onEntriesReachBottom"/)
    expect(entries).toMatch(/class="card card--flush"/)
    expect(wxss).toMatch(/\.entries-scroll\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0/)
    // 分页由滚动区触底事件驱动（复用 loadMoreEntries）
    expect(js).toMatch(/onEntriesReachBottom\(\)[\s\S]{0,80}loadMoreEntries/)
  })

  test('v2.4 默认头像兜底：包内资产存在、首页/详情页在数据层兜底、资料页保持操作占位', () => {
    const img = path.join(__dirname, '../../miniprogram/images/default-avatar.png')
    expect(fs.existsSync(img)).toBe(true)
    expect(fs.statSync(img).size).toBeGreaterThan(0)
    const cfg = readIf(path.join(__dirname, '../../miniprogram/config/assets.js'))
    expect(cfg).toMatch(/exports\.DEFAULT_AVATAR_PATH = '\/images\/default-avatar\.png'/)
    const room = readIf(path.join(pagesDir, 'room', 'room.js'))
    expect(room).toMatch(/avatarFileID:\s*m\.avatarFileID\s*\|\|\s*DEFAULT_AVATAR_PATH/)
    expect(room).toMatch(/avatarFileID:\s*target\.avatarFileID\s*\|\|\s*DEFAULT_AVATAR_PATH/)
    const index = readIf(path.join(pagesDir, 'index', 'index.js'))
    expect(index).toMatch(/avatarFileID:\s*u\.avatarFileID\s*\|\|\s*DEFAULT_AVATAR_PATH/)
    // 资料页是「选择头像」操作引导，不渲染他人视角，不应被兜底污染
    const profile = readIf(path.join(pagesDir, 'profile', 'profile.js'))
    const profileWxml = readIf(path.join(pagesDir, 'profile', 'profile.wxml'))
    expect(profile).not.toMatch(/DEFAULT_AVATAR_PATH/)
    expect(profileWxml).not.toMatch(/default-avatar/)
  })

  test('v2.5 缓存策略：内存缓存模块 + api-client 在途去重 + 页面缓存接线，且全程不落 Storage', () => {
    // 缓存模块仅用内存 Map，不触碰任何持久化 API
    const cache = require('../../miniprogram/utils/cache')
    expect(typeof cache.get).toBe('function')
    expect(typeof cache.set).toBe('function')
    expect(typeof cache.remove).toBe('function')
    const cacheSrc = readIf(path.join(__dirname, '../../miniprogram/utils/cache.js'))
    expect(cacheSrc).not.toMatch(/wx\.(setStorage|getStorage|removeStorage|clearStorage)/)

    // api-client 具备在途去重与测试接缝
    const api = readIf(path.join(__dirname, '../../miniprogram/services/api-client.js'))
    expect(api).toMatch(/inflight/)
    expect(api).toMatch(/dedupKey/)
    expect(api).toMatch(/clearInflight/)

    // 首页/详情页/加入页均接入缓存（读或失效）
    for (const name of ['index', 'room', 'join']) {
      const js = readIf(path.join(pagesDir, name, `${name}.js`))
      expect(js).toMatch(/require\('\.\.\/\.\.\/utils\/cache'\)/)
    }

    // 页面不直接调 wx.cloud（去重也不绕开统一出云通道）
    for (const name of PAGES) {
      const js = readIf(path.join(pagesDir, name, `${name}.js`))
      expect(js).not.toMatch(/wx\.cloud\.|callFunction\(/)
    }
  })

  test('v2.6 闲置自动结束：定时器只在 room 云函数声明，前端无入口且不复制阈值', () => {
    const cfgPath = path.join(__dirname, '../../cloudfunctions/room/config.json')
    expect(fs.existsSync(cfgPath)).toBe(true) // 缺 config.json：定时器不会随部署生效
    expect(JSON.parse(fs.readFileSync(cfgPath, 'utf8'))).toEqual({
      triggers: [{ name: 'autoEndIdle', type: 'timer', config: '0 30 4 * * * *' }]
    })

    // 判据在服务端：前端没有任何 autoEndIdle 调用面
    const roomJs = readIf(path.join(pagesDir, 'room', 'room.js'))
    const services = fs
      .readdirSync(path.join(__dirname, '../../miniprogram/services'))
      .map((f) => readIf(path.join(__dirname, '../../miniprogram/services', f)))
      .join('\n')
    expect(roomJs).not.toMatch(/autoEndIdle/)
    expect(services).not.toMatch(/autoEndIdle/)

    // 前端只有展示窗口，不得复制 7 天阈值（阈值改动只发生在 shared/constants.js）
    expect(roomJs).toMatch(/IDLE_PREWARN_WINDOW_MS/)
    expect(roomJs).not.toMatch(/7\s*\*\s*24\s*\*\s*60\s*\*\s*60/)

    // 云函数侧：timer-only 守卫 + 阈值/原因常量集中定义
    const handlers = readIf(path.join(__dirname, '../../cloudfunctions/room/handlers.js'))
    expect(handlers).toMatch(/ctx\.source !== 'timer'/)
    const constants = readIf(path.join(__dirname, '../../shared/constants.js'))
    expect(constants).toMatch(/IDLE_AUTO_END_MS = 7 \* 24 \* 60 \* 60 \* 1000/)
    expect(constants).toMatch(/END_REASON_IDLE = 'idle'/)
  })

  test('v2.6 详情页标注接线：自动结束标注与预告条都绑到数据字段', () => {
    const wxml = readIf(path.join(pagesDir, 'room', 'room.wxml'))
    const js = readIf(path.join(pagesDir, 'room', 'room.js'))
    // 已结束标注区分 endReason；进行中临近时点走同一条 notice 样式（wx:elif 互斥）
    expect(wxml).toMatch(/wx:if="\{\{endedReadonly\}\}"[\s\S]*?endedByIdle \? '牌局已因长期未记账自动结束/)
    expect(wxml).toMatch(/wx:elif="\{\{idlePrewarnText\}\}"[\s\S]*?\{\{idlePrewarnText\}\}/)
    expect(wxml).toMatch(/notice--warning room-notice/) // 复用既有 notice 视觉，不另起炉灶
    expect(js).toMatch(/endedByIdle: room\.status === 'ended' && room\.endReason === 'idle'/)
    expect(js).toMatch(/idlePrewarnText: idlePrewarnText\(room, Date\.now\(\)\)/)
  })

  test('v2.7 隐私接线：弹窗前置到页面入口、采集动作前各留兜底、开关与统计口径一致', () => {
    // 采集范围与「用户隐私保护指引」保持一致的两个开关
    expect(app.usePrivacyCheck).toBe(true)
    const appJs = readIf(path.join(__dirname, '../../miniprogram/app.js'))
    // traceUser 会往云开发控制台记录「谁访问过」，属于指引里没承诺的采集，不开
    expect(appJs).not.toMatch(/traceUser:\s*true/)

    // 页面一律走 utils/privacy，不各自直接调 wx 隐私接口（否则弹窗时机与文案会散开）
    for (const name of PAGES) {
      const js = readIf(path.join(pagesDir, name, `${name}.js`))
      expect(js).not.toMatch(/wx\.requirePrivacyAuthorize|wx\.openPrivacyContract/)
    }
    const util = readIf(path.join(__dirname, '../../miniprogram/utils/privacy.js'))
    expect(util).toMatch(/wx\.requirePrivacyAuthorize/)
    expect(util).toMatch(/wx\.openPrivacyContract/)

    // 首页进一次即弹（不 await 列表），资料页入口也弹
    const index = readIf(path.join(pagesDir, 'index', 'index.js'))
    expect(index).toMatch(/privacy\.ensurePrivacyOnce\(\)/)
    const profile = readIf(path.join(pagesDir, 'profile', 'profile.js'))
    expect(profile).toMatch(/onLoad\(\)[\s\S]{0,400}this\.ensurePrivacy\(\)/)
    // 采集出口两处兜底：上传头像、保存资料
    expect(profile).toMatch(/async uploadAvatar\(tempFilePath\)[\s\S]{0,200}await this\.ensurePrivacy\(\)/)
    expect(profile).toMatch(/async onSave[\s\S]{0,600}await this\.ensurePrivacy\(\)/)

    // 指引正文入口（微信生成的那一页，不需要自建协议页）
    const profileWxml = readIf(path.join(pagesDir, 'profile', 'profile.wxml'))
    expect(profileWxml).toMatch(/bindtap="tapPrivacyContract"/)
    expect(profileWxml).toMatch(/《小程序用户隐私保护指引》/)
    const profileJs = readIf(path.join(pagesDir, 'profile', 'profile.js'))
    expect(profileJs).toMatch(/privacy\.openPrivacyContract\(\)/)
  })
})
