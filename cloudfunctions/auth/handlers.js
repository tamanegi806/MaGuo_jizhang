/**
 * auth 云函数处理器
 * 处理器签名：async handler(payload, ctx)
 * ctx = { openid, userRepo, now, log }
 * 可独立导入测试：注入内存仓储与固定时钟
 */

// 优先解析项目根 shared/（本地测试与实现共享同一 AppError 类实例，instanceof 才可靠）；
// 部署后函数包外无此路径，回退到包内同步副本 ./shared/
let errorsMod
try {
  errorsMod = require('../../shared/errors')
} catch (_) {
  errorsMod = require('./shared/errors')
}
const { AppError, ErrorCodes } = errorsMod

const NICKNAME_MAX_LEN = 20

/**
 * 统一对外用户结构（Date 已按约定转为毫秒时间戳）
 * @param {object} user
 */
function shapeUser(user) {
  return {
    openid: user.openid,
    nickname: user.nickname || '',
    avatarFileID: user.avatarFileID || '',
    profileComplete: Boolean(user.nickname),
    createdAt: user.createdAt
  }
}

/**
 * 未认证检查
 * @param {object} ctx
 */
function requireOpenid(ctx) {
  if (!ctx || !ctx.openid) {
    throw new AppError(ErrorCodes.UNAUTHENTICATED, 'UNAUTHENTICATED')
  }
}

/**
 * login — 自动注册登录
 * 按 openid 查询 users；不存在则插入空资料；并发冲突时重新查询。
 * @param {{}} payload
 * @param {object} ctx
 * @returns {Promise<{user: object, isNew: boolean}>}
 */
async function login(payload, ctx) {
  requireOpenid(ctx)
  const { openid, userRepo, now } = ctx

  let user = await userRepo.findByOpenid(openid)
  let isNew = false

  if (!user) {
    const fresh = {
      openid,
      nickname: '',
      avatarFileID: '',
      createdAt: now(),
      updatedAt: now()
    }
    try {
      user = await userRepo.insert(fresh)
      isNew = true
    } catch (_) {
      // 并发首登：另一请求已插入，重新查询
      user = await userRepo.findByOpenid(openid)
      if (!user) {
        throw new AppError(ErrorCodes.INTERNAL_ERROR, 'login: insert failed and user still missing')
      }
      isNew = false
    }
  }

  return { user: shapeUser(user), isNew }
}

/**
 * updateProfile — 更新昵称与头像
 * 昵称 trim 后 1~20 字符；avatarFileID 可选，非空必须以 cloud:// 开头。
 * @param {{nickname: string, avatarFileID?: string}} payload
 * @param {object} ctx
 * @returns {Promise<{user: object}>}
 */
async function updateProfile(payload, ctx) {
  requireOpenid(ctx)
  const p = payload || {}
  const { userRepo, now } = ctx

  const nickname = typeof p.nickname === 'string' ? p.nickname.trim() : ''
  if (nickname.length < 1 || nickname.length > NICKNAME_MAX_LEN) {
    throw new AppError(ErrorCodes.INVALID_PROFILE, 'INVALID_PROFILE')
  }

  const avatarFileID = p.avatarFileID === undefined || p.avatarFileID === null ? '' : p.avatarFileID
  if (typeof avatarFileID !== 'string') {
    throw new AppError(ErrorCodes.INVALID_PROFILE, 'INVALID_PROFILE')
  }
  if (avatarFileID !== '' && !avatarFileID.startsWith('cloud://')) {
    throw new AppError(ErrorCodes.INVALID_PROFILE, 'INVALID_PROFILE')
  }

  // 未首登直接进入资料页的兜底：复用 login 的查/建逻辑
  const existing = await userRepo.findByOpenid(ctx.openid)
  if (!existing) {
    await login({}, ctx)
  }

  await userRepo.update(ctx.openid, { nickname, avatarFileID, updatedAt: now() })
  const user = await userRepo.findByOpenid(ctx.openid)
  return { user: shapeUser(user) }
}

module.exports = { login, updateProfile, shapeUser }
