/**
 * 完善资料页测试 — 头像上传、昵称校验、保存/稍后再说、隐私授权
 */

jest.mock('../../miniprogram/services/auth-service', () => ({
  login: jest.fn(),
  updateProfile: jest.fn(),
  uploadAvatar: jest.fn()
}))

const authService = require('../../miniprogram/services/auth-service')
const {
  loadPageOptions,
  createInstance,
  createWxMock,
  flushPromises,
  mockGetApp
} = require('../helpers/page-harness')

const opts = loadPageOptions('../../miniprogram/pages/profile/profile')

let wx
let globalData

beforeEach(() => {
  jest.clearAllMocks()
  wx = createWxMock()
  global.wx = wx
  globalData = mockGetApp({
    user: { openid: 'o_me_1234abcd', nickname: '', avatarFileID: '', profileComplete: false },
    needProfile: true
  })
})

function open() {
  const inst = createInstance(opts)
  inst.onLoad()
  return inst
}

describe('pages/profile', () => {
  test('首登进入：显示稍后再说；非首登显示返回', () => {
    const first = open()
    expect(first.data.isInitial).toBe(true)

    globalData.needProfile = false
    const later = open()
    expect(later.data.isInitial).toBe(false)
  })

  test('选择头像 -> uploadAvatar 并记录 fileID', async () => {
    authService.uploadAvatar.mockResolvedValue('cloud://avatars/o_me/1.png')
    const inst = open()
    inst.onChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp_1.png' } })
    expect(inst.data.uploading).toBe(true)
    await flushPromises()
    expect(authService.uploadAvatar).toHaveBeenCalledWith('wxfile://tmp_1.png')
    expect(inst.data.avatarFileID).toBe('cloud://avatars/o_me/1.png')
    expect(inst.data.uploading).toBe(false)
  })

  test('头像上传失败 -> 错误提示且不阻断昵称保存', async () => {
    authService.uploadAvatar.mockRejectedValue({ code: 5001 })
    const inst = open()
    inst.onChooseAvatar({ detail: { avatarUrl: 'wxfile://x' } })
    await flushPromises()
    expect(inst.data.error).not.toBeNull()

    inst.onInputNickname({ detail: { value: '小明' } })
    authService.updateProfile.mockResolvedValue({ openid: 'o_me', nickname: '小明', profileComplete: true })
    await inst.tapSave()
    await flushPromises()
    expect(authService.updateProfile).toHaveBeenCalledWith({ nickname: '小明', avatarFileID: '' })
  })

  test('昵称空/超长 -> 校验提示不发请求', async () => {
    const inst = open()
    await inst.tapSave()
    expect(inst.data.nicknameError).toBe('请输入昵称')
    expect(authService.updateProfile).not.toHaveBeenCalled()

    inst.onInputNickname({ detail: { value: '名'.repeat(21) } })
    await inst.tapSave()
    expect(inst.data.nicknameError).toContain('20')
    expect(authService.updateProfile).not.toHaveBeenCalled()
  })

  test('保存成功 -> updateProfile、globalData 更新、返回', async () => {
    const user = { openid: 'o_me_1234abcd', nickname: '小明', avatarFileID: 'cloud://a.png', profileComplete: true }
    authService.updateProfile.mockResolvedValue(user)
    const inst = open()
    inst.onInputNickname({ detail: { value: ' 小明 ' } })
    inst.setData({ avatarFileID: 'cloud://a.png' })
    await inst.tapSave()
    await flushPromises()
    expect(authService.updateProfile).toHaveBeenCalledWith({ nickname: '小明', avatarFileID: 'cloud://a.png' })
    expect(globalData.user).toEqual(user)
    expect(globalData.needProfile).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({ title: '已保存', icon: 'success' })
    expect(wx.navigateBack).toHaveBeenCalled()
  })

  test('保存失败 -> 保留页面错误', async () => {
    authService.updateProfile.mockRejectedValue({ code: 1003, message: 'INVALID_PROFILE' })
    const inst = open()
    inst.onInputNickname({ detail: { value: '小明' } })
    await inst.tapSave()
    await flushPromises()
    expect(inst.data.error).toEqual({ code: 1003, message: '昵称或头像不符合要求' })
    expect(wx.navigateBack).not.toHaveBeenCalled()
  })

  test('稍后再说 -> 临时昵称「玩家+后4位」兜底保存', async () => {
    const user = { openid: 'o_me_1234abcd', nickname: '玩家abcd', profileComplete: true }
    authService.updateProfile.mockResolvedValue(user)
    const inst = open()
    await inst.tapLater()
    await flushPromises()
    expect(authService.updateProfile).toHaveBeenCalledWith({ nickname: '玩家abcd', avatarFileID: '' })
    expect(globalData.needProfile).toBe(false)
  })

  test('隐私授权拒绝 -> 中止保存并不调用服务', async () => {
    wx.requirePrivacyAuthorize = jest.fn(({ fail }) => fail(new Error('deny')))
    const inst = open()
    inst.onInputNickname({ detail: { value: '小明' } })
    await inst.tapSave()
    await flushPromises()
    expect(inst.data.error).toEqual({ code: 'PRIVACY', message: '需要同意隐私保护指引后才能继续' })
    expect(authService.updateProfile).not.toHaveBeenCalled()
  })

  test('隐私授权通过 -> 正常保存', async () => {
    wx.requirePrivacyAuthorize = jest.fn(({ success }) => success())
    authService.updateProfile.mockResolvedValue({ openid: 'o_me', nickname: '小明', profileComplete: true })
    const inst = open()
    inst.onInputNickname({ detail: { value: '小明' } })
    await inst.tapSave()
    await flushPromises()
    expect(wx.requirePrivacyAuthorize).toHaveBeenCalled()
    expect(authService.updateProfile).toHaveBeenCalled()
  })
})
