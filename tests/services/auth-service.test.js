/**
 * auth-service 单元测试 — mock api-client 与 wx.cloud.uploadFile
 */

// 部分 mock：只替换 call，保留真实 ApiError 类
jest.mock('../../miniprogram/services/api-client', () => {
  const actual = jest.requireActual('../../miniprogram/services/api-client')
  return { ...actual, call: jest.fn() }
})

const apiClient = require('../../miniprogram/services/api-client')
const { login, updateProfile, uploadAvatar } = require('../../miniprogram/services/auth-service')

const mockCall = apiClient.call

// 全局桩：getApp / wx.cloud.uploadFile
let globalData
beforeEach(() => {
  globalData = { user: null }
  global.getApp = jest.fn(() => ({ globalData }))
  global.wx = { cloud: { uploadFile: jest.fn() } }
  mockCall.mockReset()
})

describe('login', () => {
  test('透传 auth/login 并返回 { user, isNew }', async () => {
    const payload = { user: { openid: 'o_1', profileComplete: true }, isNew: false }
    mockCall.mockResolvedValue(payload)
    await expect(login()).resolves.toEqual(payload)
    expect(mockCall).toHaveBeenCalledWith('auth', 'login', {})
  })

  test('ApiError 原样向上抛出', async () => {
    mockCall.mockRejectedValue(new apiClient.ApiError(1001, 'UNAUTHENTICATED'))
    await expect(login()).rejects.toMatchObject({ code: 1001 })
  })
})

describe('updateProfile', () => {
  test('返回解包后的 user，avatarFileID 缺省为 ""', async () => {
    mockCall.mockResolvedValue({ user: { openid: 'o_1', nickname: '张三', profileComplete: true } })
    const user = await updateProfile({ nickname: '张三' })
    expect(mockCall).toHaveBeenCalledWith('auth', 'updateProfile', { nickname: '张三', avatarFileID: '' })
    expect(user.nickname).toBe('张三')
  })

  test('传入 avatarFileID 时原样透传', async () => {
    mockCall.mockResolvedValue({ user: { avatarFileID: 'cloud://x' } })
    await updateProfile({ nickname: '李', avatarFileID: 'cloud://x' })
    expect(mockCall).toHaveBeenCalledWith(
      'auth',
      'updateProfile',
      { nickname: '李', avatarFileID: 'cloud://x' }
    )
  })

  test('INVALID_PROFILE 错误向上抛出', async () => {
    mockCall.mockRejectedValue(new apiClient.ApiError(1003, 'INVALID_PROFILE'))
    await expect(updateProfile({ nickname: '' })).rejects.toMatchObject({ code: 1003 })
  })
})

describe('uploadAvatar', () => {
  const OLD_NOW = Date.now

  beforeEach(() => {
    Date.now = () => 1762500000000
  })
  afterAll(() => {
    Date.now = OLD_NOW
  })

  test('按 avatars/{openid}/{ts}.png 上传并返回 fileID', async () => {
    globalData.user = { openid: 'o_abc' }
    wx.cloud.uploadFile.mockResolvedValue({ fileID: 'cloud://env/avatars/o_abc/1762500000000.png' })
    const fileID = await uploadAvatar('/tmp/head.png')
    expect(wx.cloud.uploadFile).toHaveBeenCalledWith({
      cloudPath: 'avatars/o_abc/1762500000000.png',
      filePath: '/tmp/head.png'
    })
    expect(fileID).toBe('cloud://env/avatars/o_abc/1762500000000.png')
  })

  test('未登录时用 anonymous 目录兜底', async () => {
    globalData.user = null
    wx.cloud.uploadFile.mockResolvedValue({ fileID: 'cloud://x' })
    await uploadAvatar('/tmp/a.png')
    expect(wx.cloud.uploadFile.mock.calls[0][0].cloudPath).toMatch(/^avatars\/anonymous\/\d+\.png$/)
  })

  test('空 tempFilePath -> 抛错且不调用上传', async () => {
    await expect(uploadAvatar('')).rejects.toThrow('缺少头像临时路径')
    expect(wx.cloud.uploadFile).not.toHaveBeenCalled()
  })

  test('上传失败时透传 wx 错误', async () => {
    wx.cloud.uploadFile.mockRejectedValue({ errMsg: 'uploadFile fail' })
    await expect(uploadAvatar('/tmp/a.png')).rejects.toEqual({ errMsg: 'uploadFile fail' })
  })
})
