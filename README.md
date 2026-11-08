# 麻将记账 MaGuo_jizhang

朋友开一局麻将，用手机随手记「谁给谁多少」，结束时自动算出每人该收、该付多少。

微信小程序**原生开发** + **微信云开发（TCB）**：没有自建服务器，没有第三方后端，数据全在云开发自己的库里。

---

## 功能

| 模块 | 能力 |
| --- | --- |
| 牌局 | 一键创建 · 四位邀请码加入（单局最多 7 人）· 进行中 / 已结束列表 · 房主结束 · 仅房主且已结束的牌局可删除 |
| 记账 | 底部弹层「记一笔」，只允许**本人给他人**转账；金额以「分」为单位存取，避免浮点误差；重复点击与弱网重试靠幂等键去重 |
| 结算 | 实时每人净盈亏、收 / 付方向、对转建议（`shared/settlement.js`，纯函数、可单测） |
| 邀请 | 邀请码 + 小程序码（`invite` 云函数生成，加载失败可重试 / 复制邀请码） |
| 闲置 | 连续 7 天没有记账、也没有新人加入的进行中牌局，由定时触发器**自动结束**并标注结束原因；牌局结束后旧邀请码归档失效，提示「邀请码无效」 |
| 体验 | 首屏 SWR 缓存（先出缓存再后台校验）· 流水分页 + 滚动分批加载 · 临近自动结束的提示 · 默认头像 |

安全边界：所有身份一律取 `cloud.getWXContext().OPENID`，前端不传、也不可信前端传的身份；房间成员、牌局状态、金额合法性都在云函数里再校验一遍。

---

## 技术栈

- 小程序：原生 WXML / WXSS / JS + `Page` / `Component`，无跨端框架、无 UI 库
- 后端：微信云开发云函数（`wx-server-sdk ~2.6.3`）+ 云数据库（文档型）
- 前端网络层：`miniprogram/services/api-client.js` 统一封装 `wx.cloud.callFunction`（请求 ID、在途去重、错误码 → 文案）
- 测试：Jest 29 + `miniprogram-simulate`（自定义组件真实渲染）

---

## 目录结构

```
miniprogram/            小程序端
  pages/                index 牌局列表 · room 牌局详情 · join 加入 · profile 我的
  components/           entry-sheet 记账弹层 · invite-sheet 邀请弹层 · entry-card · amount-input · state-view
  services/             api-client + auth / room / entry / invite 四个领域服务
  utils/                cache（TTL 内存缓存）· privacy（隐私授权）· format · date · uuid · error-message
  config/               env（云环境 ID）· assets（默认头像）
  shared/               ← 由 scripts/sync-shared.js 生成，勿直接编辑

cloudfunctions/         云函数（每个目录独立部署）
  auth/                 login · updateProfile
  room/                 create · join · list · detail · end · remove · autoEndIdle
  entry/                add · list
  invite/               qr（小程序码）
  _shared/              云函数专用共享码：response · auth-guard · validate · logger · entry-format
  <fn>/shared/          ← 由 sync 脚本生成，勿直接编辑

shared/                 业务契约的单一事实源：constants · money · settlement · permissions · entry · user · invite-code · errors
scripts/sync-shared.js  把 shared/ 与 _shared/ 同步到小程序端和各云函数目录
tests/                  unit · services · cloud · pages · components（Jest，32 套件 / 537 用例）
```

每个云函数 `index.js` 只做「解析 event → 建上下文 → `dispatch({ action, payload })`」，业务在 `handlers.js`，数据库读写在 `repositories.js`，依赖全部构造注入，因此处理器测试可以用 `tests/helpers/fake-repos.js` 的内存仓储跑，无需连云环境。

---

## 快速开始

```bash
npm install
npm test          # 32 套件 / 537 用例，全程离线
```

1. 用微信开发者工具「导入项目」，选择**本仓库根目录**；
2. 把 `project.config.json` 里的 `appid` 换成你自己的小程序 AppID；
3. 在开发者工具里开通云开发，新建一个环境，把环境 ID 填到 `miniprogram/config/env.js` 的 `CLOUD_ENV_ID`；
4. 按下一节建好集合与索引；
5. 按再下一节部署云函数，然后就能本地编译预览了。

---

## 数据库

在云开发控制台新建三个集合（集合名即 `shared/constants.js` 里的常量）：

| 集合 | 必填索引 | 为什么 |
| --- | --- | --- |
| `users` | `openid` **唯一** | 首次登录插入冲突时回落为重查，靠它保证一人一档 |
| `rooms` | `inviteCode` **唯一**<br>`ownerOpenid` + `createdByRequestId` **唯一** | 邀请码不撞车；创建请求重放时返回同一个房间 |
| `entries` | `roomId` + `clientRequestId` **唯一** | 记账幂等的**唯一**依据，缺了它会重复记账 |

建议再加两个普通索引（列表与翻页都走它们）：`rooms(status, updatedAt)` —— 闲置扫描按 `updatedAt` 升序取（默认上限 500）；`entries(roomId, createdAt)` —— 流水按时间倒序分页。

权限：三个集合都设为「仅创建者可读写」或直接关闭客户端权限——小程序端**不直连数据库**，一切读写都经云函数。

---

## 隐私与合规

采集范围刻意压到最小，只有这几项：

| 信息 | 来源 | 用途 |
| --- | --- | --- |
| `openid` | 云函数侧 `cloud.getWXContext().OPENID`，前端传的不算 | 身份、成员校验、幂等 |
| 昵称 | 用户自己填（可跳过，兜底为「玩家+编号」） | 牌局里区分「谁给谁记账」 |
| 头像 | 用户自己选并上传云存储（不传则用默认头像） | 同上 |
| 牌局与流水（成员、转账对象、金额、时间） | 用户的记账行为 | 结算与历史记录 |

**不采集**：手机号、地理位置、通讯录、相册（用户主动选的头像除外）、摄像头/麦克风、设备信息；无第三方 SDK、无埋点与统计上报（`wx.cloud.init` 也不带 `traceUser`）。

上线前必须在微信公众平台「设置 → 服务内容声明 → 用户隐私保护指引」里勾上**昵称、头像**并写明用途——不声明，正式版的 `chooseAvatar` 与 `type="nickname"` 会被直接拦掉。代码侧的配套接线：

- `app.json` 开启 `usePrivacyCheck`；
- `miniprogram/utils/privacy.js` 统一封装授权请求（未决期间共享同一个弹窗、会话内只打扰一次），页面不直接调 `wx.requirePrivacyAuthorize`；
- 弹窗时机前置到首页 `onShow` 与资料页 `onLoad`，但**拒绝不锁功能**：列表、记账、结算照常，只有「上传头像」「保存昵称」这两个采集动作被中止；
- 资料页底部有《小程序用户隐私保护指引》文字链（`wx.openPrivacyContract`），不用自建协议页。

**已知待补**（补齐前，指引文案里别承诺）：用户侧「清除我的资料 / 注销」入口；已结束牌局的留存期限清理。

---

## 部署云函数

在开发者工具的「云函数」目录里，对 `auth` / `room` / `entry` / `invite` **逐个**右键 →

> 上传并部署：云端安装依赖（不上传 node_modules）

然后上传定时触发器——这一步容易被漏掉，`room` 的闲置自动结束靠它：

> 右键 `cloudfunctions/room/config.json` → 「上传触发器」

触发器定义（每天 04:30 扫一轮：按 `updatedAt` 升序取进行中的牌局，单轮最多结束 `IDLE_AUTO_END_BATCH = 50` 局）：

```json
{ "triggers": [{ "name": "autoEndIdle", "type": "timer", "config": "0 30 4 * * * *" }] }
```

手动验证它（不用等到 7 天）：云开发控制台 → 云函数 → `room` → 云端测试，填入

```json
{ "TriggerName": "autoEndIdle", "Type": "Timer" }
```

`index.js` 只认 `event.Type === 'Timer'` 这个信号才会把来源标成 `timer`；普通 `callFunction` 调用走到 `autoEndIdle` 会被拒绝（`UNAUTHENTICATED`），所以外部调用改不了别人的牌局。想让某局被扫到：`status` 留作 `active`，把 `lastActivityAt` 改到 7 天以前（判据优先读它，缺失时才回退 `max(createdAt, updatedAt)`），并顺手把 `updatedAt` 也改早——扫描按 `updatedAt` 升序取，太新的会掉在批次窗口外面。

其他两点配置建议：运行时选 Node.js 16；`room` 的超时时间适当调大（定时器一轮内可能连做多笔事务）。

---

## 改共享代码

`shared/` 是业务契约的单一事实源，但云函数不能跨目录 `require`，小程序也不能直接读仓库根，所以用同步脚本生成副本（副本头部带 `!AUTO-GENERATED` 标记）：

```bash
# 改完 shared/ 或 cloudfunctions/_shared/ 之后
npm run sync:shared
npm test
```

`cloudfunctions/<fn>/shared/` 与 `miniprogram/shared/` 都是生成物，**不要**直接编辑，改动会在下次同步时被覆盖。

---

## 测试

```bash
npm test                 # 全量
npm run test:watch
npm run test:coverage
```

- `tests/unit` 金额、结算、权限、邀请码、错误码等纯函数
- `tests/services` 小程序端服务与缓存（SWR、失效、在途去重）
- `tests/cloud` 云函数处理器 + 真实 `repositories.js` 的数据路径（用会「报错」的 mock 数据库钉住事务契约）
- `tests/pages` / `tests/components` 页面与自定义组件渲染、交互

测试完全离线，不需要云环境，也不产生任何真实数据。

---

## 说明

本仓库是公开镜像，只放代码与测试；设计文档、需求与决策记录、开发者工具产物（`doc/`、`minitest/`、`.screenshots/`）都写在 `.gitignore` 里，不入库。
