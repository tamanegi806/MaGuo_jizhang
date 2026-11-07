/**
 * invite 云函数处理器测试 — mock cloud.openapi / cloud.uploadFile
 * 覆盖 INV-01 ~ INV-08
 */

const handlers = require('../../cloudfunctions/invite/handlers')
const { AppError, ErrorCodes } = require('../../shared/errors')
const { FakeRoomRepo } = require('../helpers/fake-repos')
// INV-07/08 的 scene/code 解析实现于前端 invite-service（纯函数，无 wx 依赖）
const { parseJoinScene, parseJoinCode } = require('../../miniprogram/services/invite-service')

const MEMBER = 'o_invite_member'
const OUTSIDER = 'o_invite_outsider'

function makeCloud() {
  return {
    openapi: {
      wxacode: {
        getUnlimited: jest.fn().mockResolvedValue({ buffer: Buffer.from('png-bytes') })
      }
    },
    uploadFile: jest.fn().mockResolvedValue({ fileID: 'cloud://env.abc/qrcodes/r_1/release.png' })
  }
}

async function makeCtx({ status = 'active', members = [MEMBER] } = {}) {
  const roomRepo = new FakeRoomRepo()
  const room = await roomRepo.seed({
    name: '邀请局',
    ownerOpenid: MEMBER,
    memberOpenids: members,
    members: members.map((m) => ({ openid: m, joinedAt: 1 })),
    status,
    inviteCode: 'A7K2M9',
    createdByRequestId: 'q1',
    createdAt: 1,
    updatedAt: 1,
    endedAt: null
  })
  return {
    ctx: { openid: MEMBER, roomRepo, cloud: makeCloud(), envVersion: 'release', now: () => 2 },
    room
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

describe('qr', () => {
  test('INV-01 成员生成 -> fileID/邀请码/分享路径', async () => {
    const { ctx, room } = await makeCtx()
    const res = await handlers.qr({ roomId: room._id }, ctx)
    expect(res.fileID).toContain('qrcodes')
    expect(res.inviteCode).toBe('A7K2M9')
    expect(res.sharePath).toBe('/pages/join/join?code=A7K2M9')
  })

  test('INV-02 非成员 -> NOT_ROOM_MEMBER', async () => {
    const { ctx, room } = await makeCtx()
    const outsiderCtx = { ...ctx, openid: OUTSIDER }
    await expectCode(() => handlers.qr({ roomId: room._id }, outsiderCtx), ErrorCodes.NOT_ROOM_MEMBER)
    expect(ctx.cloud.openapi.wxacode.getUnlimited).not.toHaveBeenCalled()
  })

  test('INV-03 已结束 -> ROOM_ENDED', async () => {
    const { ctx, room } = await makeCtx({ status: 'ended' })
    await expectCode(() => handlers.qr({ roomId: room._id }, ctx), ErrorCodes.ROOM_ENDED)
  })

  test('房间不存在 -> ROOM_NOT_FOUND', async () => {
    const { ctx } = await makeCtx()
    await expectCode(() => handlers.qr({ roomId: 'r_missing' }, ctx), ErrorCodes.ROOM_NOT_FOUND)
  })

  test('缺少 roomId -> INVALID_PARAM', async () => {
    const { ctx } = await makeCtx()
    await expectCode(() => handlers.qr({}, ctx), ErrorCodes.INVALID_PARAM)
  })

  test('INV-04 scene 为 c=邀请码 且 ≤32 字符，page/checkPath 正确', async () => {
    const { ctx, room } = await makeCtx()
    await handlers.qr({ roomId: room._id }, ctx)
    const arg = ctx.cloud.openapi.wxacode.getUnlimited.mock.calls[0][0]
    expect(arg.scene).toBe('c=A7K2M9')
    expect(arg.scene.length).toBeLessThanOrEqual(32)
    expect(arg.page).toBe('pages/join/join')
    expect(arg.checkPath).toBe(false)
    expect(arg.envVersion).toBe('release')
  })

  test('上传路径为 qrcodes/{roomId}/{envVersion}.png', async () => {
    const { ctx, room } = await makeCtx()
    await handlers.qr({ roomId: room._id }, ctx)
    expect(ctx.cloud.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ cloudPath: `qrcodes/${room._id}/release.png` })
    )
  })

  test('INV-05 openapi 抛错 -> QR_GENERATE_FAILED', async () => {
    const { ctx, room } = await makeCtx()
    ctx.cloud.openapi.wxacode.getUnlimited = jest
      .fn()
      .mockRejectedValue({ errMsg: 'openapi 41001 credential empty' })
    await expectCode(() => handlers.qr({ roomId: room._id }, ctx), ErrorCodes.QR_GENERATE_FAILED)
  })

  test('openapi 返回空 buffer -> QR_GENERATE_FAILED', async () => {
    const { ctx, room } = await makeCtx()
    ctx.cloud.openapi.wxacode.getUnlimited = jest.fn().mockResolvedValue({})
    await expectCode(() => handlers.qr({ roomId: room._id }, ctx), ErrorCodes.QR_GENERATE_FAILED)
  })

  test('上传失败 -> QR_GENERATE_FAILED', async () => {
    const { ctx, room } = await makeCtx()
    ctx.cloud.uploadFile = jest.fn().mockRejectedValue(new Error('storage down'))
    await expectCode(() => handlers.qr({ roomId: room._id }, ctx), ErrorCodes.QR_GENERATE_FAILED)
  })

  test('INV-06 分享路径格式（多房间码一致）', async () => {
    const { ctx, room } = await makeCtx()
    const res = await handlers.qr({ roomId: room._id }, ctx)
    expect(res.sharePath).toMatch(/^\/pages\/join\/join\?code=[0-9A-Z]{6}$/)
  })
})

describe('scene/code 解析（INV-07 / INV-08）', () => {
  test('INV-07 URL 编码 scene -> 邀请码', () => {
    expect(parseJoinScene('c%3DA7K2M9')).toBe('A7K2M9')
  })

  test('原始 scene 亦可', () => {
    expect(parseJoinScene('c=A7K2M9')).toBe('A7K2M9')
  })

  test('小写 scene 规范化为大写', () => {
    expect(parseJoinScene('c=a7k2m9')).toBe('A7K2M9')
  })

  test('非法 scene -> 空串', () => {
    expect(parseJoinScene('')).toBe('')
    expect(parseJoinScene('other')).toBe('')
    expect(parseJoinScene('c=')).toBe('')
    expect(parseJoinScene(null)).toBe('')
    expect(parseJoinScene('%zz')).toBe('')
  })

  test('INV-08 分享参数 code -> 邀请码', () => {
    expect(parseJoinCode('A7K2M9')).toBe('A7K2M9')
    expect(parseJoinCode(' a7k2m9 ')).toBe('A7K2M9')
    expect(parseJoinCode('')).toBe('')
    expect(parseJoinCode(undefined)).toBe('')
  })
})
