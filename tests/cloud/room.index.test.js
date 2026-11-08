/**
 * room 云函数入口测试（v2.6 定时器分发）
 * 契约：config.json 的 Timer 事件（event.Type === 'Timer'）必须转 autoEndIdle 并打上 ctx.source='timer'；
 * 普通 callFunction 即使点名 action=autoEndIdle，也会被 handler 的 timer-only 守卫拒绝。
 * 用例编号：ROOM-INDEX-xx
 *
 * 注意：jest 把 jest.mock 工厂提升到 require 之前，工厂只能引用 mock 前缀变量（提升安全）。
 */

var mockRoom = null

jest.mock(
  'wx-server-sdk',
  () => ({
    DYNAMIC_CURRENT_ENV: 'dynamic-env',
    init: () => {},
    getWXContext: () => ({ OPENID: 'o_index_timer' }),
    database: () => ({ command: {} })
  }),
  { virtual: true } // 依赖只装在 cloudfunctions/ 部署包内，仓库根未安装
)

jest.mock('../../cloudfunctions/room/repositories', () => ({
  // 仓储层整体委托给当前用例的内存房仓：入口只该关心分发，不该关心事务
  createRepositories: () =>
    new Proxy(
      {},
      {
        get: (_target, prop) =>
          typeof prop === 'string' ? (...args) => mockRoom[prop](...args) : undefined
      }
    )
}))

// 本地仓库中 response.js 优先解析包内 ./errors，与 handlers.js 使用的根 shared/errors 非同一实例，
// dispatch 的 instanceof 判定会退化为 5001；部署后两者是同一文件。此处对齐部署形态。
jest.mock('../../cloudfunctions/room/shared/errors', () => require('../../shared/errors'))

const { main } = require('../../cloudfunctions/room/index')
const { ErrorCodes } = require('../../shared/errors')
const { FakeRoomRepo } = require('../helpers/fake-repos')

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function seedActive(roomRepo, id, lastActivityAt) {
  return roomRepo.seed({
    _id: id,
    name: '',
    ownerOpenid: 'o_index_timer',
    memberOpenids: ['o_index_timer'],
    members: [{ openid: 'o_index_timer', joinedAt: 1 }],
    status: 'active',
    inviteCode: '5021',
    createdAt: 1,
    updatedAt: lastActivityAt,
    lastActivityAt
  })
}

beforeEach(() => {
  mockRoom = new FakeRoomRepo()
})

describe('room/index.js', () => {
  test('ROOM-INDEX-01 Timer 事件 -> 分发 autoEndIdle，闲置牌局被自动结束', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
    await seedActive(mockRoom, 'r_tick', Date.now() - 8 * DAY)
    const res = await main({ Type: 'Timer', TriggerName: 'autoEndIdle' })
    expect(res.code).toBe(0)
    expect(res.data).toEqual({ scanned: 1, ended: [{ roomId: 'r_tick', inviteCode: 'E:r_tick' }] })
    expect(res.requestId).toBe('autoEndIdle')
    const room = await mockRoom.findById('r_tick')
    expect(room.status).toBe('ended')
    expect(room.endReason).toBe('idle')
    infoSpy.mockRestore()
  })

  test('ROOM-INDEX-02 Timer 事件但无闲置牌局 -> 空转成功', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
    await seedActive(mockRoom, 'r_fresh', Date.now() - HOUR)
    const res = await main({ Type: 'Timer', TriggerName: 'autoEndIdle' })
    expect(res.code).toBe(0)
    expect(res.data).toEqual({ scanned: 1, ended: [] })
    expect((await mockRoom.findById('r_fresh')).status).toBe('active')
    infoSpy.mockRestore()
  })

  test('ROOM-INDEX-03 普通 callFunction 点名 autoEndIdle -> 1001 拒绝（前端无入口）', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await seedActive(mockRoom, 'r_notimer', Date.now() - 8 * DAY)
    const res = await main({ action: 'autoEndIdle', payload: {}, requestId: 'r-attack' })
    expect(res.code).toBe(ErrorCodes.UNAUTHENTICATED)
    expect(res.requestId).toBe('r-attack')
    expect((await mockRoom.findById('r_notimer')).status).toBe('active') // 未被结束
    errSpy.mockRestore()
  })

  test('ROOM-INDEX-04 无 Type 字段的普通调用走原分发（成员列表可查）', async () => {
    await seedActive(mockRoom, 'r_list', Date.now())
    const res = await main({ action: 'list', payload: {}, requestId: 'r-list' })
    expect(res.code).toBe(0)
    expect(res.data.items).toHaveLength(1)
    expect(res.data.items[0].autoEndAt).not.toBeNull() // v2.6 出口字段随入口分发保留
  })
})
