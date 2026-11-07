/**
 * room 云函数处理器测试 — 内存仓储注入，无需云环境
 * 覆盖 ROOM-01 ~ ROOM-20
 */

const handlers = require('../../cloudfunctions/room/handlers')
const { AppError, ErrorCodes } = require('../../shared/errors')
const { computeSettlement } = require('../../shared/settlement')
const { INVITE_CODE_ALPHABET } = require('../../shared/constants')
const { isValidCodeFormat } = require('../../shared/invite-code')
const { FakeUserRepo, FakeRoomRepo, FakeEntryRepo } = require('../helpers/fake-repos')

const OWNER = 'o_owner_openid_1'
const MEMBER_B = 'o_member_bbbb_2'
const MEMBER_C = 'o_member_cccc_3'
const STRANGER = 'o_stranger_zzzz'

const NOW = 1762500000000
let clock = NOW
const now = () => (clock += 1) // 递增避免 createdAt 相同干扰排序

/** 由目标邀请码构造双参 rng（generateCode 依 rng.length>=2 走整数分支） */
function rngForCode(code) {
  const indices = String(code)
    .split('')
    .map((ch) => INVITE_CODE_ALPHABET.indexOf(ch))
  let i = 0
  return function rng(min, max) {
    // 循环返回：先给第一个 code，之后给第二个 code（每 6 位一段）
    const v = indices[i % indices.length]
    i++
    return v
  }
}

/** 构造两段邀请码的 rng：第 1 段用于第 1 次尝试，第 2 段用于后续（形参个数决定 generateCode 的整数分支） */
function rngForCodes(first, second) {
  const a = first.split('').map((c) => INVITE_CODE_ALPHABET.indexOf(c))
  const b = second.split('').map((c) => INVITE_CODE_ALPHABET.indexOf(c))
  const seq = [...a, ...b]
  let i = 0
  return function rng(min, max) {
    const v = i < seq.length ? seq[i] : seq[seq.length - 1]
    i++
    return v
  }
}

function makeCtx({ userRepo, roomRepo, entryRepo } = {}) {
  return {
    openid: OWNER,
    userRepo: userRepo || new FakeUserRepo(),
    roomRepo: roomRepo || new FakeRoomRepo(),
    entryRepo: entryRepo || new FakeEntryRepo(),
    computeSettlement,
    now
  }
}

async function seedUser(userRepo, openid, nickname) {
  await userRepo.insert({ openid, nickname, avatarFileID: '', createdAt: now(), updatedAt: now() })
}

function expectCode(fn, code) {
  return fn().then(
    () => {
      throw new Error(`expected error ${code}, but resolved`)
    },
    (e) => {
      expect(e).toBeInstanceOf(AppError)
      expect(e.code).toBe(code)
    }
  )
}

describe('create', () => {
  test('ROOM-01 合法名称 -> 创建房间、房主为唯一成员、含邀请码', async () => {
    const ctx = makeCtx()
    await seedUser(ctx.userRepo, OWNER, '张三')
    const res = await handlers.create(
      { name: '周五夜场', clientRequestId: 'req_000001' },
      { ...ctx, rng: rngForCode('ABC234') }
    )
    expect(res.room.name).toBe('周五夜场')
    expect(res.room.status).toBe('active')
    expect(res.room.memberCount).toBe(1)
    expect(res.room.inviteCode).toBe('ABC234')
    expect(res.idempotent).toBeUndefined()
    // 房主自动成为成员
    const room = await ctx.roomRepo.findById(res.room.roomId)
    expect(room.memberOpenids).toEqual([OWNER])
    expect(room.members[0].openid).toBe(OWNER)
    expect(room.ownerOpenid).toBe(OWNER)
    expect(room.createdByRequestId).toBe('req_000001')
  })

  test('ROOM-02 名称缺省/空白 -> 创建成功且 name 为空串（v1.4 起名称可选）', async () => {
    const ctx = makeCtx()
    await seedUser(ctx.userRepo, OWNER, '张三')
    const r1 = await handlers.create({ clientRequestId: 'req_noname' }, ctx)
    expect(r1.room.name).toBe('')
    const r2 = await handlers.create({ name: '   ', clientRequestId: 'req_ws' }, ctx)
    expect(r2.room.name).toBe('')
  })

  test('ROOM-02b 名称 31 字 -> INVALID_PARAM', async () => {
    const ctx = makeCtx()
    await seedUser(ctx.userRepo, OWNER, '张三')
    await expectCode(
      () => handlers.create({ name: 'a'.repeat(31), clientRequestId: 'req_1' }, ctx),
      ErrorCodes.INVALID_PARAM
    )
  })

  test('ROOM-02c 缺少 clientRequestId -> INVALID_PARAM', async () => {
    const ctx = makeCtx()
    await seedUser(ctx.userRepo, OWNER, '张三')
    await expectCode(() => handlers.create({ name: 'ok' }, ctx), ErrorCodes.INVALID_PARAM)
  })

  test('昵称为空 -> PROFILE_INCOMPLETE', async () => {
    const ctx = makeCtx()
    await seedUser(ctx.userRepo, OWNER, '')
    await expectCode(
      () => handlers.create({ name: 'ok', clientRequestId: 'req_1' }, ctx),
      ErrorCodes.PROFILE_INCOMPLETE
    )
  })

  test('ROOM-03 相同 clientRequestId 重试 -> 返回同一房间（幂等）', async () => {
    const ctx = makeCtx()
    await seedUser(ctx.userRepo, OWNER, '张三')
    const p = { name: '同一局', clientRequestId: 'req_dup' }
    const r1 = await handlers.create(p, { ...ctx, rng: rngForCode('AAAAAA') })
    const r2 = await handlers.create(p, { ...ctx, rng: rngForCode('BBBBBB') })
    expect(r2.room.roomId).toBe(r1.room.roomId)
    expect(r2.idempotent).toBe(true)
    // 第二次用了不同码，但返回的仍是首间房
    expect(r2.room.inviteCode).toBe('AAAAAA')
  })

  test('ROOM-04 邀请码冲突 -> 重试生成新码', async () => {
    // 首个 code 'CCCCCC' 冲突，第二个 'DDDDDD' 成功
    const c2 = makeCtx({ roomRepo: new FakeRoomRepo({ conflictInviteCodes: ['CCCCCC'] }) })
    await seedUser(c2.userRepo, OWNER, '张三')
    const res = await handlers.create(
      { name: '重试局', clientRequestId: 'req_retry' },
      { ...c2, rng: rngForCodes('CCCCCC', 'DDDDDD') }
    )
    expect(res.room.inviteCode).toBe('DDDDDD')
  })

  test('ROOM-04b 连续冲突超过重试上限 -> INTERNAL_ERROR', async () => {
    const ctx = makeCtx()
    await seedUser(ctx.userRepo, OWNER, '张三')
    const roomRepo = new FakeRoomRepo({ conflictInviteCodes: ['EEEEEE'] })
    await expectCode(
      () =>
        handlers.create(
          { name: '倒霉局', clientRequestId: 'req_bad' },
          { ...ctx, roomRepo, rng: rngForCode('EEEEEE') }
        ),
      ErrorCodes.INTERNAL_ERROR
    )
  })

  test('ROOM-04c 未注入 rng -> 内置随机源可连续创建不同码（回归：曾恒生成 222222 导致第二次创建 INTERNAL_ERROR）', async () => {
    const ctx = makeCtx() // 不提供 ctx.rng，走 handlers 内置 defaultRng
    await seedUser(ctx.userRepo, OWNER, '张三')
    const codes = []
    for (let i = 0; i < 10; i++) {
      const res = await handlers.create(
        { name: `默认随机局 ${i}`, clientRequestId: `req_def_${i}` },
        ctx
      )
      codes.push(res.room.inviteCode)
    }
    codes.forEach((c) => expect(isValidCodeFormat(c)).toBe(true))
    expect(new Set(codes).size).toBeGreaterThan(1)
  })

  test('并发幂等冲突 -> 重查命中已有房间', async () => {
    const ctx = makeCtx()
    await seedUser(ctx.userRepo, OWNER, '张三')
    const roomRepo = new FakeRoomRepo({ forceIdempotencyConflict: true })
    const res = await handlers.create(
      { name: '并发局', clientRequestId: 'req_conc' },
      { ...ctx, roomRepo, rng: rngForCode('FFFFFF') }
    )
    expect(res.idempotent).toBe(true)
    expect(res.room.name).toBe('并发局')
  })
})

describe('join', () => {
  async function seededRoom(overrides = {}) {
    const roomRepo = new FakeRoomRepo()
    const room = await roomRepo.seed({
      name: '邀请局',
      ownerOpenid: OWNER,
      memberOpenids: [OWNER],
      members: [{ openid: OWNER, joinedAt: NOW }],
      status: 'active',
      inviteCode: 'ZZ2345',
      createdByRequestId: 'r1',
      createdAt: NOW,
      updatedAt: NOW,
      endedAt: null,
      ...overrides
    })
    return { roomRepo, room }
  }

  test('ROOM-05 邀请码加入 -> 新成员、alreadyMember=false', async () => {
    const { roomRepo, room } = await seededRoom()
    const ctx = { ...makeCtx({ roomRepo }), openid: MEMBER_B }
    const res = await handlers.join({ inviteCode: 'zz2345' }, ctx) // 小写应被规范化
    expect(res.alreadyMember).toBe(false)
    expect(res.room.memberCount).toBe(2)
    const after = await roomRepo.findById(room._id)
    expect(after.memberOpenids).toContain(MEMBER_B)
    expect(after.members.map((m) => m.openid)).toContain(MEMBER_B)
  })

  test('ROOM-06 重复加入 -> alreadyMember=true', async () => {
    const { roomRepo } = await seededRoom({ memberOpenids: [OWNER, MEMBER_B], members: [{ openid: OWNER, joinedAt: NOW }, { openid: MEMBER_B, joinedAt: NOW }] })
    const ctx = { ...makeCtx({ roomRepo }), openid: MEMBER_B }
    const res = await handlers.join({ inviteCode: 'ZZ2345' }, ctx)
    expect(res.alreadyMember).toBe(true)
  })

  test('ROOM-07 非成员加入已结束 -> ROOM_ENDED', async () => {
    const { roomRepo } = await seededRoom({ status: 'ended', endedAt: NOW })
    const ctx = { ...makeCtx({ roomRepo }), openid: STRANGER }
    await expectCode(() => handlers.join({ inviteCode: 'ZZ2345' }, ctx), ErrorCodes.ROOM_ENDED)
  })

  test('ROOM-07b 成员再次加入已结束 -> 成功 alreadyMember=true', async () => {
    const { roomRepo } = await seededRoom({ status: 'ended', memberOpenids: [OWNER, MEMBER_B], members: [{ openid: OWNER, joinedAt: NOW }, { openid: MEMBER_B, joinedAt: NOW }] })
    const ctx = { ...makeCtx({ roomRepo }), openid: MEMBER_B }
    const res = await handlers.join({ inviteCode: 'ZZ2345' }, ctx)
    expect(res.alreadyMember).toBe(true)
  })

  test('ROOM-08 不存在邀请码 -> INVALID_INVITE_CODE', async () => {
    const { roomRepo } = await seededRoom()
    const ctx = { ...makeCtx({ roomRepo }), openid: STRANGER }
    await expectCode(() => handlers.join({ inviteCode: 'QQQQQQ' }, ctx), ErrorCodes.INVALID_INVITE_CODE)
  })

  test('ROOM-09 邀请码格式错误 -> INVALID_INVITE_CODE_FORMAT', async () => {
    const ctx = makeCtx()
    await expectCode(() => handlers.join({ inviteCode: 'ab' }, ctx), ErrorCodes.INVALID_INVITE_CODE_FORMAT)
    await expectCode(
      () => handlers.join({ inviteCode: 'abc123' }, ctx), // 含非法字符 1（已排除）
      ErrorCodes.INVALID_INVITE_CODE_FORMAT
    )
  })

  test('ROOM-10 成员数达上限 -> ROOM_FULL', async () => {
    const members = new Array(100).fill(0).map((_, i) => `o_m_${i}`)
    const { roomRepo } = await seededRoom({ memberOpenids: members, members: members.map((m) => ({ openid: m, joinedAt: NOW })) })
    const ctx = { ...makeCtx({ roomRepo }), openid: STRANGER }
    await expectCode(() => handlers.join({ inviteCode: 'ZZ2345' }, ctx), ErrorCodes.ROOM_FULL)
  })
})

describe('list', () => {
  async function seedMany(roomRepo, openid, count, startTs) {
    for (let i = 0; i < count; i++) {
      await roomRepo.seed({
        name: `局${i}`,
        ownerOpenid: openid,
        memberOpenids: [openid],
        members: [{ openid, joinedAt: startTs + i }],
        status: 'active',
        inviteCode: `L${String(i).padStart(5, '0')}`.slice(0, 6),
        createdByRequestId: `cr_${openid}_${i}`,
        createdAt: startTs + i,
        updatedAt: startTs + i,
        endedAt: null
      })
    }
  }

  test('ROOM-11 只返回自己参与的牌局', async () => {
    const roomRepo = new FakeRoomRepo()
    await seedMany(roomRepo, OWNER, 2, 1000)
    await seedMany(roomRepo, MEMBER_B, 1, 5000) // 他人牌局
    const ctx = { ...makeCtx({ roomRepo }), openid: OWNER }
    const res = await handlers.list({ page: 0, pageSize: 20 }, ctx)
    expect(res.items).toHaveLength(2)
    expect(res.items.every((r) => r.memberCount === 1)).toBe(true)
  })

  test('ROOM-12 列表按 createdAt 倒序', async () => {
    const roomRepo = new FakeRoomRepo()
    await seedMany(roomRepo, OWNER, 3, 1000)
    const ctx = { ...makeCtx({ roomRepo }), openid: OWNER }
    const res = await handlers.list({}, ctx)
    const ts = res.items.map((r) => r.createdAt)
    expect(ts).toEqual([...ts].sort((a, b) => b - a))
  })

  test('ROOM-13 分页 hasMore', async () => {
    const roomRepo = new FakeRoomRepo()
    await seedMany(roomRepo, OWNER, 5, 1000)
    const ctx = { ...makeCtx({ roomRepo }), openid: OWNER }
    const p0 = await handlers.list({ page: 0, pageSize: 2 }, ctx)
    expect(p0.items).toHaveLength(2)
    expect(p0.hasMore).toBe(true)
    const pLast = await handlers.list({ page: 2, pageSize: 2 }, ctx)
    expect(pLast.hasMore).toBe(false)
  })

  test('pageSize 上限截断到 50', async () => {
    const roomRepo = new FakeRoomRepo()
    await seedMany(roomRepo, OWNER, 3, 1000)
    const ctx = { ...makeCtx({ roomRepo }), openid: OWNER }
    const res = await handlers.list({ page: 0, pageSize: 999 }, ctx)
    expect(res.items).toHaveLength(3)
    expect(res.hasMore).toBe(false)
  })
})

describe('detail', () => {
  async function buildRoom(withEntries) {
    const roomRepo = new FakeRoomRepo()
    const userRepo = new FakeUserRepo()
    const entryRepo = new FakeEntryRepo()
    await seedUser(userRepo, OWNER, '张三')
    await seedUser(userRepo, MEMBER_B, '李四')
    await seedUser(userRepo, MEMBER_C, '') // 空昵称 -> 临时昵称
    const members = [
      { openid: OWNER, joinedAt: 1 },
      { openid: MEMBER_B, joinedAt: 2 },
      { openid: MEMBER_C, joinedAt: 3 }
    ]
    const room = await roomRepo.seed({
      name: '详情局',
      ownerOpenid: OWNER,
      memberOpenids: [OWNER, MEMBER_B, MEMBER_C],
      members,
      status: 'active',
      inviteCode: 'D12345',
      createdByRequestId: 'd1',
      createdAt: 1000,
      updatedAt: 1000,
      endedAt: null
    })
    if (withEntries) {
      await entryRepo.insert({ roomId: room._id, fromOpenid: OWNER, toOpenid: MEMBER_B, amountCents: 5000, createdBy: OWNER, createdAt: 2000 })
      await entryRepo.insert({ roomId: room._id, fromOpenid: OWNER, toOpenid: MEMBER_C, amountCents: 3000, createdBy: OWNER, createdAt: 1500 })
    }
    return { roomRepo, userRepo, entryRepo, room }
  }

  test('ROOM-14 非成员查看详情 -> NOT_ROOM_MEMBER', async () => {
    const repos = await buildRoom(true)
    const ctx = { ...makeCtx(repos), openid: STRANGER }
    await expectCode(() => handlers.detail({ roomId: repos.room._id }, ctx), ErrorCodes.NOT_ROOM_MEMBER)
  })

  test('ROOM-14b 房间不存在 -> ROOM_NOT_FOUND', async () => {
    const repos = await buildRoom(false)
    const ctx = { ...makeCtx(repos), openid: OWNER }
    await expectCode(() => handlers.detail({ roomId: 'r_missing' }, ctx), ErrorCodes.ROOM_NOT_FOUND)
  })

  test('ROOM-15 成员查看 -> 成员/结算/最近流水/权限', async () => {
    const repos = await buildRoom(true)
    const ctx = { ...makeCtx(repos), openid: OWNER }
    const res = await handlers.detail({ roomId: repos.room._id }, ctx)

    expect(res.members).toHaveLength(3)
    const zhang = res.members.find((m) => m.openid === OWNER)
    expect(zhang.nickname).toBe('张三')
    // 空昵称成员使用临时昵称：玩家 + openid 后 4 位
    const c = res.members.find((m) => m.openid === MEMBER_C)
    expect(c.nickname).toBe(`玩家${MEMBER_C.slice(-4)}`)
    expect(res.room.inviteCode).toBe('D12345')
    expect(res.room.ownerOpenid).toBe(OWNER)

    // 结算：张三 -8000，李四 +5000，王五 +3000
    const byOpenid = Object.fromEntries(res.settlement.map((s) => [s.openid, s.totalCents]))
    expect(byOpenid[OWNER]).toBe(-8000)
    expect(byOpenid[MEMBER_B]).toBe(5000)
    expect(byOpenid[MEMBER_C]).toBe(3000)
    // 结算按净额降序
    expect(res.settlement[0].totalCents).toBe(5000)

    // 最近流水按 createdAt 倒序
    expect(res.recentEntries).toHaveLength(2)
    expect(res.recentEntries[0].createdAt).toBe(2000)
    expect(res.recentEntries[0].amountText).toBe('¥50.00')

    // 权限（房主、进行中）
    expect(res.permissions).toEqual({
      canAddEntry: true,
      canEndRoom: true,
      canInvite: true,
      canDeleteRoom: true
    })
  })

  test('ROOM-16 无流水成员 -> 结算净额 0 仍出现', async () => {
    const repos = await buildRoom(false)
    const ctx = { ...makeCtx(repos), openid: OWNER }
    const res = await handlers.detail({ roomId: repos.room._id }, ctx)
    expect(res.settlement).toHaveLength(3)
    expect(res.settlement.every((s) => s.totalCents === 0)).toBe(true)
    expect(res.recentEntries).toEqual([])
  })

  test('ROOM-20 已结束详情 -> 写权限全 false', async () => {
    const repos = await buildRoom(true)
    await repos.roomRepo.endRoom(repos.room._id, NOW)
    const ctx = { ...makeCtx(repos), openid: OWNER }
    const res = await handlers.detail({ roomId: repos.room._id }, ctx)
    expect(res.room.status).toBe('ended')
    expect(res.permissions).toEqual({
      canAddEntry: false,
      canEndRoom: false,
      canInvite: false,
      canDeleteRoom: true // 房主仍可清理历史记录
    })
  })
})

describe('end', () => {
  async function seeded() {
    const roomRepo = new FakeRoomRepo()
    const room = await roomRepo.seed({
      name: '结束局',
      ownerOpenid: OWNER,
      memberOpenids: [OWNER, MEMBER_B],
      members: [{ openid: OWNER, joinedAt: 1 }, { openid: MEMBER_B, joinedAt: 2 }],
      status: 'active',
      inviteCode: 'E12345',
      createdByRequestId: 'e1',
      createdAt: 1000,
      updatedAt: 1000,
      endedAt: null
    })
    return { roomRepo, room }
  }

  test('ROOM-17 房主结束 -> status=ended、endedAt 有值', async () => {
    const { roomRepo, room } = await seeded()
    const ctx = { ...makeCtx({ roomRepo }), openid: OWNER }
    const res = await handlers.end({ roomId: room._id }, ctx)
    expect(res.room.status).toBe('ended')
    expect(res.room.endedAt).toBeGreaterThan(0)
    expect(res.alreadyEnded).toBe(false)
  })

  test('ROOM-18 非房主结束 -> NOT_ROOM_OWNER', async () => {
    const { roomRepo, room } = await seeded()
    const ctx = { ...makeCtx({ roomRepo }), openid: MEMBER_B }
    await expectCode(() => handlers.end({ roomId: room._id }, ctx), ErrorCodes.NOT_ROOM_OWNER)
  })

  test('ROOM-19 重复结束 -> 幂等成功', async () => {
    const { roomRepo, room } = await seeded()
    const ctx = { ...makeCtx({ roomRepo }), openid: OWNER }
    await handlers.end({ roomId: room._id }, ctx)
    const res = await handlers.end({ roomId: room._id }, ctx)
    expect(res.room.status).toBe('ended')
    expect(res.alreadyEnded).toBe(true)
  })

  test('结束不存在的房间 -> ROOM_NOT_FOUND', async () => {
    const { roomRepo } = await seeded()
    const ctx = { ...makeCtx({ roomRepo }), openid: OWNER }
    await expectCode(() => handlers.end({ roomId: 'r_ghost' }, ctx), ErrorCodes.ROOM_NOT_FOUND)
  })
})

describe('remove', () => {
  async function seededWithEntries(status = 'active') {
    const roomRepo = new FakeRoomRepo()
    const entryRepo = new FakeEntryRepo()
    const room = await roomRepo.seed({
      name: '删除局',
      ownerOpenid: OWNER,
      memberOpenids: [OWNER, MEMBER_B],
      members: [{ openid: OWNER, joinedAt: 1 }, { openid: MEMBER_B, joinedAt: 2 }],
      status,
      inviteCode: 'R12345',
      createdByRequestId: 'rm1',
      createdAt: 1000,
      updatedAt: 1000,
      endedAt: status === 'ended' ? 2000 : null
    })
    await entryRepo.insert({ roomId: room._id, fromOpenid: OWNER, toOpenid: MEMBER_B, amountCents: 5000, createdBy: OWNER, createdAt: 2000 })
    await entryRepo.insert({ roomId: room._id, fromOpenid: MEMBER_B, toOpenid: OWNER, amountCents: 3000, createdBy: OWNER, createdAt: 2100 })
    await entryRepo.insert({ roomId: 'r_other', fromOpenid: OWNER, toOpenid: MEMBER_B, amountCents: 100, createdBy: OWNER, createdAt: 2200 })
    return { roomRepo, entryRepo, room }
  }

  test('ROOM-21 房主删除进行中 -> 房间与流水清除，他牌局流水保留', async () => {
    const { roomRepo, entryRepo, room } = await seededWithEntries()
    const ctx = { ...makeCtx({ roomRepo, entryRepo }), openid: OWNER }
    const res = await handlers.remove({ roomId: room._id }, ctx)
    expect(res).toEqual({ roomId: room._id, deleted: true, deletedEntries: 2 })
    expect(await roomRepo.findById(room._id)).toBeNull()
    expect(await entryRepo.countByRoom(room._id)).toBe(0)
    expect(await entryRepo.countByRoom('r_other')).toBe(1) // 不误删他牌局流水
  })

  test('ROOM-22 房主删除已结束牌局 -> 成功（历史清理）', async () => {
    const { roomRepo, entryRepo, room } = await seededWithEntries('ended')
    const ctx = { ...makeCtx({ roomRepo, entryRepo }), openid: OWNER }
    const res = await handlers.remove({ roomId: room._id }, ctx)
    expect(res.deleted).toBe(true)
    expect(await roomRepo.findById(room._id)).toBeNull()
  })

  test('ROOM-23 非房主删除 -> NOT_ROOM_OWNER', async () => {
    const { roomRepo, entryRepo, room } = await seededWithEntries()
    const ctx = { ...makeCtx({ roomRepo, entryRepo }), openid: MEMBER_B }
    await expectCode(() => handlers.remove({ roomId: room._id }, ctx), ErrorCodes.NOT_ROOM_OWNER)
    expect(await roomRepo.findById(room._id)).not.toBeNull() // 未删除
    expect(await entryRepo.countByRoom(room._id)).toBe(2)
  })

  test('ROOM-24 删除不存在的牌局 -> ROOM_NOT_FOUND', async () => {
    const { roomRepo } = await seededWithEntries()
    const ctx = { ...makeCtx({ roomRepo }), openid: OWNER }
    await expectCode(() => handlers.remove({ roomId: 'r_ghost' }, ctx), ErrorCodes.ROOM_NOT_FOUND)
  })

  test('缺少 roomId -> INVALID_PARAM', async () => {
    const ctx = makeCtx()
    await expectCode(() => handlers.remove({}, ctx), ErrorCodes.INVALID_PARAM)
  })
})
