/**
 * auth 云函数处理器测试 — 使用内存仓储，无需云环境
 */

const { login, updateProfile } = require('../../cloudfunctions/auth/handlers')
const { AppError, ErrorCodes } = require('../../shared/errors')
const { FakeUserRepo } = require('../helpers/fake-repos')

const OPENID = 'o_auth_test_openid'
const NOW = 1762500000000

function makeCtx(userRepo = new FakeUserRepo()) {
  return { openid: OPENID, userRepo, now: () => NOW }
}

describe('login', () => {
  test('AUTH-01 新 openid 首登 -> 创建用户、isNew=true、profileComplete=false', async () => {
    const ctx = makeCtx()
    const res = await login({}, ctx)
    expect(res.isNew).toBe(true)
    expect(res.user.openid).toBe(OPENID)
    expect(res.user.nickname).toBe('')
    expect(res.user.profileComplete).toBe(false)
    expect(res.user.createdAt).toBe(NOW)
    const stored = await ctx.userRepo.findByOpenid(OPENID)
    expect(stored.updatedAt).toBe(NOW)
  })

  test('AUTH-02 已存在用户 -> 返回原用户、isNew=false', async () => {
    const userRepo = new FakeUserRepo()
    await userRepo.insert({
      openid: OPENID,
      nickname: '张三',
      avatarFileID: 'cloud://env/avatars/x.png',
      createdAt: 1000,
      updatedAt: 1000
    })
    const res = await login({}, makeCtx(userRepo))
    expect(res.isNew).toBe(false)
    expect(res.user.nickname).toBe('张三')
    expect(res.user.profileComplete).toBe(true)
    expect(res.user.createdAt).toBe(1000)
  })

  test('AUTH-03 并发首登冲突 -> 重查后返回同一用户，isNew=false', async () => {
    const userRepo = new FakeUserRepo()
    await userRepo.insert({ openid: OPENID, nickname: '', avatarFileID: '', createdAt: 999, updatedAt: 999 })
    // findByOpenid 首次返回 null（模拟读写窗口），随后冲突路径可见用户
    let firstCall = true
    const orig = userRepo.findByOpenid.bind(userRepo)
    userRepo.findByOpenid = async (openid) => {
      if (firstCall) {
        firstCall = false
        return null
      }
      return orig(openid)
    }
    const res = await login({}, makeCtx(userRepo))
    expect(res.isNew).toBe(false)
    expect(res.user.createdAt).toBe(999)
  })

  test('AUTH 冲突后仍查不到用户 -> INTERNAL_ERROR', async () => {
    const userRepo = new FakeUserRepo()
    userRepo.insert = jest.fn(async (u) => {
      await userRepo._data.set(u.openid, u) // 制造存在记录
      throw new Error('duplicate')
    })
    userRepo.findByOpenid = jest.fn().mockResolvedValue(null)
    try {
      await login({}, makeCtx(userRepo))
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AppError)
      expect(e.code).toBe(ErrorCodes.INTERNAL_ERROR)
    }
  })

  test('无 openid -> UNAUTHENTICATED', async () => {
    const ctx = { openid: '', userRepo: new FakeUserRepo(), now: () => NOW }
    await expect(login({}, ctx)).rejects.toEqual(
      expect.objectContaining({ code: ErrorCodes.UNAUTHENTICATED })
    )
  })
})

describe('updateProfile', () => {
  async function seeded() {
    const ctx = makeCtx()
    await login({}, ctx)
    return ctx
  }

  test('AUTH-04 昵称前后空格 -> 保存去空格后的值', async () => {
    const ctx = await seeded()
    const res = await updateProfile({ nickname: '  李四  ' }, ctx)
    expect(res.user.nickname).toBe('李四')
    expect(res.user.profileComplete).toBe(true)
  })

  test('昵称恰好 20 字 -> 通过', async () => {
    const ctx = await seeded()
    const name = 'a'.repeat(20)
    const res = await updateProfile({ nickname: ` ${name} ` }, ctx)
    expect(res.user.nickname).toBe(name)
  })

  test('AUTH-05 昵称为空 -> INVALID_PROFILE', async () => {
    const ctx = await seeded()
    await expect(updateProfile({ nickname: '   ' }, ctx)).rejects.toEqual(
      expect.objectContaining({ code: ErrorCodes.INVALID_PROFILE })
    )
  })

  test('AUTH-05b 昵称 21 字 -> INVALID_PROFILE', async () => {
    const ctx = await seeded()
    await expect(updateProfile({ nickname: 'a'.repeat(21) }, ctx)).rejects.toEqual(
      expect.objectContaining({ code: ErrorCodes.INVALID_PROFILE })
    )
  })

  test('AUTH-05c 昵称非字符串 -> INVALID_PROFILE', async () => {
    const ctx = await seeded()
    await expect(updateProfile({ nickname: 123 }, ctx)).rejects.toEqual(
      expect.objectContaining({ code: ErrorCodes.INVALID_PROFILE })
    )
  })

  test('AUTH-06 头像非 cloud:// 前缀 -> INVALID_PROFILE', async () => {
    const ctx = await seeded()
    await expect(
      updateProfile({ nickname: '王五', avatarFileID: 'http://cdn/x.png' }, ctx)
    ).rejects.toEqual(expect.objectContaining({ code: ErrorCodes.INVALID_PROFILE }))
  })

  test('AUTH-07 头像为空 -> 更新成功', async () => {
    const ctx = await seeded()
    const res = await updateProfile({ nickname: '王五', avatarFileID: '' }, ctx)
    expect(res.user.nickname).toBe('王五')
    expect(res.user.avatarFileID).toBe('')
  })

  test('省略 avatarFileID -> 保持空字符串', async () => {
    const ctx = await seeded()
    const res = await updateProfile({ nickname: '赵六' }, ctx)
    expect(res.user.avatarFileID).toBe('')
  })

  test('合法头像 fileID 原样保存', async () => {
    const ctx = await seeded()
    const fileID = 'cloud://env-x.avatars/o_auth/1762500.png'
    const res = await updateProfile({ nickname: '赵六', avatarFileID: fileID }, ctx)
    expect(res.user.avatarFileID).toBe(fileID)
  })

  test('未首登直接更新 -> 兜底建档后成功（无资料页直达场景）', async () => {
    const ctx = makeCtx()
    const res = await updateProfile({ nickname: '首进用户' }, ctx)
    expect(res.user.nickname).toBe('首进用户')
    expect(res.user.createdAt).toBe(NOW)
  })

  test('无 openid -> UNAUTHENTICATED', async () => {
    const ctx = { openid: '', userRepo: new FakeUserRepo(), now: () => NOW }
    await expect(updateProfile({ nickname: 'x' }, ctx)).rejects.toEqual(
      expect.objectContaining({ code: ErrorCodes.UNAUTHENTICATED })
    )
  })
})
