/**
 * entry 云函数处理器测试 — 内存仓储，覆盖 ENTRY-01 ~ ENTRY-16
 */

const handlers = require('../../cloudfunctions/entry/handlers')
const { AppError, ErrorCodes } = require('../../shared/errors')
const { MAX_AMOUNT_CENTS } = require('../../shared/constants')
const { FakeUserRepo, FakeRoomRepo, FakeEntryRepo } = require('../helpers/fake-repos')

const A = 'o_player_aaaa'
const B = 'o_player_bbbb'
const C = 'o_player_cccc' // 空昵称
const OUTSIDER = 'o_outsider_x'

let clock = 1762500000000
const now = () => (clock += 1000)

async function buildWorld({ members = [A, B, C], status = 'active', nonameMember = C } = {}) {
  const roomRepo = new FakeRoomRepo()
  const room = await roomRepo.seed({
    name: '流水局',
    ownerOpenid: A,
    memberOpenids: members,
    members: members.map((m) => ({ openid: m, joinedAt: now() })),
    status,
    inviteCode: 'AAA222',
    createdByRequestId: 'cr_seed',
    createdAt: now(),
    updatedAt: now(),
    endedAt: null
  })
  const userRepo = new FakeUserRepo()
  for (const m of members) {
    await userRepo.insert({
      openid: m,
      nickname: m === nonameMember ? '' : `昵称_${m.slice(-4)}`,
      avatarFileID: '',
      createdAt: now(),
      updatedAt: now()
    })
  }
  const entryRepo = new FakeEntryRepo({ roomRepo })
  return {
    roomRepo,
    userRepo,
    entryRepo,
    room,
    ctx: { openid: A, roomRepo, userRepo, entryRepo, now }
  }
}

function expectCode(fn, code) {
  return fn().then(
    () => {
      throw new Error(`expected code ${code}, resolved`)
    },
    (e) => {
      expect(e).toBeInstanceOf(AppError)
      expect(e.code).toBe(code)
    }
  )
}

const validInput = (over = {}) => ({
  roomId: null,
  fromOpenid: A,
  toOpenid: B,
  amountCents: 5000,
  clientRequestId: 'req-0001',
  ...over
})

describe('add', () => {
  test('ENTRY-01 合法流水新增 -> duplicated=false，含双方昵称与金额文本', async () => {
    const w = await buildWorld()
    const res = await handlers.add(validInput({ roomId: w.room._id }), w.ctx)
    expect(res.duplicated).toBe(false)
    expect(res.entry.amountCents).toBe(5000)
    expect(res.entry.amountText).toBe('¥50.00')
    expect(res.entry.fromNickname).toBe(`昵称_${A.slice(-4)}`)
    expect(res.entry.toNickname).toBe(`昵称_${B.slice(-4)}`)
    expect(await w.entryRepo.countByRoom(w.room._id)).toBe(1)
  })

  test('ENTRY-02 连续新增 3 笔 -> 累计 3 条独立流水', async () => {
    const w = await buildWorld()
    for (let i = 0; i < 3; i++) {
      await handlers.add(validInput({ roomId: w.room._id, clientRequestId: `req_${i}` }), w.ctx)
    }
    expect(await w.entryRepo.countByRoom(w.room._id)).toBe(3)
  })

  test('ENTRY-03 并发新增不同 clientRequestId 不覆盖', async () => {
    const w = await buildWorld()
    await handlers.add(validInput({ roomId: w.room._id, clientRequestId: 'x-1', amountCents: 100 }), w.ctx)
    await handlers.add(validInput({ roomId: w.room._id, clientRequestId: 'x-2', amountCents: 200 }), w.ctx)
    const rows = await w.entryRepo.findByRoom(w.room._id)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.amountCents).sort()).toEqual([100, 200])
  })

  test('ENTRY-04 非成员调用 -> NOT_ROOM_MEMBER', async () => {
    const w = await buildWorld()
    const ctx = { ...w.ctx, openid: OUTSIDER }
    await expectCode(() => handlers.add(validInput({ roomId: w.room._id }), ctx), ErrorCodes.NOT_ROOM_MEMBER)
  })

  test('ENTRY-05 已结束牌局 -> ROOM_ENDED', async () => {
    const w = await buildWorld({ status: 'ended' })
    await expectCode(() => handlers.add(validInput({ roomId: w.room._id }), w.ctx), ErrorCodes.ROOM_ENDED)
  })

  test('房间不存在 -> ROOM_NOT_FOUND', async () => {
    const w = await buildWorld()
    await expectCode(() => handlers.add(validInput({ roomId: 'r_missing' }), w.ctx), ErrorCodes.ROOM_NOT_FOUND)
  })

  test('ENTRY-06 付款人=收款人 -> SAME_PAYER_PAYEE', async () => {
    const w = await buildWorld()
    await expectCode(
      () => handlers.add(validInput({ roomId: w.room._id, toOpenid: A }), w.ctx),
      ErrorCodes.SAME_PAYER_PAYEE
    )
  })

  test('ENTRY-07 付款人非成员 -> INVALID_MEMBER', async () => {
    const w = await buildWorld()
    await expectCode(
      () => handlers.add(validInput({ roomId: w.room._id, fromOpenid: OUTSIDER }), w.ctx),
      ErrorCodes.INVALID_MEMBER
    )
  })

  test('ENTRY-08 收款人非成员 -> INVALID_MEMBER', async () => {
    const w = await buildWorld()
    await expectCode(
      () => handlers.add(validInput({ roomId: w.room._id, toOpenid: OUTSIDER }), w.ctx),
      ErrorCodes.INVALID_MEMBER
    )
  })

  test('ENTRY-09 金额非法 -> INVALID_AMOUNT', async () => {
    const w = await buildWorld()
    const badAmounts = [0, -500, 12.5, MAX_AMOUNT_CENTS + 1]
    for (const amountCents of badAmounts) {
      await expectCode(
        () => handlers.add(validInput({ roomId: w.room._id, amountCents }), w.ctx),
        ErrorCodes.INVALID_AMOUNT
      )
    }
    // 上限本身合法
    const ok = await handlers.add(validInput({ roomId: w.room._id, amountCents: MAX_AMOUNT_CENTS }), w.ctx)
    expect(ok.entry.amountCents).toBe(MAX_AMOUNT_CENTS)
  })

  test('缺少 clientRequestId / 超 64 字 -> INVALID_PARAM', async () => {
    const w = await buildWorld()
    await expectCode(() => handlers.add(validInput({ roomId: w.room._id, clientRequestId: '' }), w.ctx), ErrorCodes.INVALID_PARAM)
    await expectCode(
      () => handlers.add(validInput({ roomId: w.room._id, clientRequestId: 'a'.repeat(65) }), w.ctx),
      ErrorCodes.INVALID_PARAM
    )
  })

  test('缺少 roomId -> INVALID_PARAM', async () => {
    const w = await buildWorld()
    await expectCode(() => handlers.add(validInput({ roomId: '' }), w.ctx), ErrorCodes.INVALID_PARAM)
  })

  test('ENTRY-10 相同 clientRequestId 重试 -> 返回原流水、duplicated=true、不新增', async () => {
    const w = await buildWorld()
    const first = await handlers.add(validInput({ roomId: w.room._id, clientRequestId: 'dup-key' }), w.ctx)
    const second = await handlers.add(
      validInput({ roomId: w.room._id, clientRequestId: 'dup-key', amountCents: 999 }),
      w.ctx
    )
    expect(second.duplicated).toBe(true)
    expect(second.entry.entryId).toBe(first.entry.entryId)
    expect(second.entry.amountCents).toBe(5000) // 保留首笔，非重试的 999
    expect(await w.entryRepo.countByRoom(w.room._id)).toBe(1)
  })

  test('并发唯一索引冲突 -> 预检落空、事务 duplicate、重查命中返回原流水', async () => {
    const w = await buildWorld()
    // 模拟并发：另一写者已插入同幂等键流水
    await w.entryRepo.insert({
      roomId: w.room._id,
      fromOpenid: A,
      toOpenid: B,
      amountCents: 777,
      createdBy: A,
      clientRequestId: 'race2',
      createdAt: now()
    })
    // 本次请求的预检“看不见”对方写入（读写窗口），事务与重查可见
    let first = true
    const origFind = w.entryRepo.findByIdempotency.bind(w.entryRepo)
    w.entryRepo.findByIdempotency = async (...args) => {
      if (first) {
        first = false
        return null
      }
      return origFind(...args)
    }
    const res = await handlers.add(validInput({ roomId: w.room._id, clientRequestId: 'race2', amountCents: 5000 }), w.ctx)
    expect(res.duplicated).toBe(true)
    expect(res.entry.amountCents).toBe(777) // 返回对方先写入的那笔
    expect(await w.entryRepo.countByRoom(w.room._id)).toBe(1)
  })

  test('ENTRY-14 昵称为空 -> 收款人显示临时昵称', async () => {
    const w = await buildWorld()
    const res = await handlers.add(validInput({ roomId: w.room._id, toOpenid: C }), w.ctx)
    expect(res.entry.toNickname).toBe(`玩家${C.slice(-4)}`)
  })

  test('ENTRY-15 v1.6 房主代记他人付款（B→C）-> PAYER_NOT_SELF，且未写入', async () => {
    const w = await buildWorld() // w.ctx.openid = A（房主）
    await expectCode(
      () => handlers.add(validInput({ roomId: w.room._id, fromOpenid: B, toOpenid: C }), w.ctx),
      ErrorCodes.PAYER_NOT_SELF
    )
    expect(await w.entryRepo.countByRoom(w.room._id)).toBe(0)
  })

  test('ENTRY-16 v1.6 任意成员记自己付出的账（自己→他人）-> 成功', async () => {
    const w = await buildWorld()
    const res = await handlers.add(
      validInput({ roomId: w.room._id, fromOpenid: B, toOpenid: C }),
      { ...w.ctx, openid: B }
    )
    expect(res.duplicated).toBe(false)
    expect(res.entry.fromOpenid).toBe(B)
  })
})

describe('list', () => {
  async function seededEntries(w, n) {
    const out = []
    for (let i = 0; i < n; i++) {
      const e = await w.entryRepo.insert({
        roomId: w.room._id,
        fromOpenid: A,
        toOpenid: B,
        amountCents: (i + 1) * 100,
        createdBy: A,
        clientRequestId: `l_${i}`,
        createdAt: 1000 + i * 1000
      })
      out.push(e)
    }
    return out
  }

  test('ENTRY-11 列表按时间倒序', async () => {
    const w = await buildWorld()
    await seededEntries(w, 3)
    const res = await handlers.list({ roomId: w.room._id, page: 0, pageSize: 10 }, w.ctx)
    expect(res.items).toHaveLength(3)
    const ts = res.items.map((e) => e.createdAt)
    expect(ts).toEqual([...ts].sort((a, b) => b - a))
  })

  test('ENTRY-12 列表分页 hasMore', async () => {
    const w = await buildWorld()
    await seededEntries(w, 5)
    const p0 = await handlers.list({ roomId: w.room._id, page: 0, pageSize: 2 }, w.ctx)
    expect(p0.items).toHaveLength(2)
    expect(p0.hasMore).toBe(true)
    const p2 = await handlers.list({ roomId: w.room._id, page: 2, pageSize: 2 }, w.ctx)
    expect(p2.items).toHaveLength(1)
    expect(p2.hasMore).toBe(false)
  })

  test('ENTRY-13 返回昵称与金额文本', async () => {
    const w = await buildWorld()
    await seededEntries(w, 1)
    const res = await handlers.list({ roomId: w.room._id }, w.ctx)
    expect(res.items[0].fromNickname).toBe(`昵称_${A.slice(-4)}`)
    expect(res.items[0].toNickname).toBe(`昵称_${B.slice(-4)}`)
    expect(res.items[0].amountText).toBe('¥1.00')
  })

  test('非成员列表 -> NOT_ROOM_MEMBER', async () => {
    const w = await buildWorld()
    await expectCode(
      () => handlers.list({ roomId: w.room._id }, { ...w.ctx, openid: OUTSIDER }),
      ErrorCodes.NOT_ROOM_MEMBER
    )
  })

  test('已结束牌局仍可查列表（只读）', async () => {
    const w = await buildWorld({ status: 'ended' })
    await seededEntries(w, 2)
    const res = await handlers.list({ roomId: w.room._id }, w.ctx)
    expect(res.items).toHaveLength(2)
  })

  test('房间不存在 -> ROOM_NOT_FOUND', async () => {
    const w = await buildWorld()
    await expectCode(() => handlers.list({ roomId: 'r_ghost' }, w.ctx), ErrorCodes.ROOM_NOT_FOUND)
  })

  test('缺少 roomId -> INVALID_PARAM', async () => {
    const w = await buildWorld()
    await expectCode(() => handlers.list({}, w.ctx), ErrorCodes.INVALID_PARAM)
  })
})
