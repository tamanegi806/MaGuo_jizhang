/**
 * 完善资料页测试 — 头像上传、昵称校验、保存/稍后再说、隐私授权
 */

jest.mock('../../miniprogram/services/auth-service', () => ({
  login: jest.fn(),
  updateProfile: jest.fn(),
  uploadAvatar: jest.fn()
}))

const authService = require('../../miniprogram/services/auth-service')
const privacy = require('../../miniprogram/utils/privacy')
const {
  loadPageOptions,
  createInstance,
  createWxMock,
  flushPromises,
  mockGetApp
} = require('../helpers/page-harness')

const opts = loadPageOptions('../../miniprogram/pages/profile/profile')

const PRIVACY_DENIED = { code: 'PRIVACY', message: '需要同意隐私保护指引后才能继续' }

let wx
let globalData

beforeEach(() => {
  jest.clearAllMocks()
  privacy.resetSession() // utils/privacy 带会话级状态，用例间须隔离
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

  test('选择头像 -> 先本地预览，隐私检查通过后才上传云存储', async () => {
    authService.uploadAvatar.mockResolvedValue('cloud://avatars/o_me/1.png')
    const inst = open()
    inst.onChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp_1.png' } })
    // 同步部分只有本地预览；上传排在授权之后（v2.7：未同意不能把图片传出手机）
    expect(inst.data.avatarTempPath).toBe('wxfile://tmp_1.png')
    expect(authService.uploadAvatar).not.toHaveBeenCalled()

    await flushPromises()
    expect(authService.uploadAvatar).toHaveBeenCalledWith('wxfile://tmp_1.png')
    expect(inst.data.avatarFileID).toBe('cloud://avatars/o_me/1.png')
    expect(inst.data.uploading).toBe(false)
  })

  test('上传进行中 uploading 置位，完成后回落', async () => {
    let resolveUpload
    authService.uploadAvatar.mockImplementation(() => new Promise((r) => { resolveUpload = r }))
    const inst = open()
    inst.onChooseAvatar({ detail: { avatarUrl: 'wxfile://x.png' } })
    await flushPromises() // 过掉授权那一发
    expect(inst.data.uploading).toBe(true)

    resolveUpload('cloud://avatars/x.png')
    await flushPromises()
    expect(inst.data.uploading).toBe(false)
    expect(inst.data.avatarFileID).toBe('cloud://avatars/x.png')
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
    expect(inst.data.error).toEqual(PRIVACY_DENIED)
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

  // ---- v2.7 隐私弹窗时机前置 ----

  test('进资料页即请求授权，不必等点保存', async () => {
    wx.requirePrivacyAuthorize = jest.fn(({ success }) => success())
    const inst = open()
    await flushPromises()
    expect(wx.requirePrivacyAuthorize).toHaveBeenCalled()
    expect(inst.data.error).toBeNull()
  })

  test('进资料页即被拒绝：当场给提示，且此时还没发出任何采集请求', async () => {
    wx.requirePrivacyAuthorize = jest.fn(({ fail }) => fail(new Error('deny')))
    const inst = open()
    await flushPromises()
    expect(inst.data.error).toEqual(PRIVACY_DENIED)
    expect(authService.uploadAvatar).not.toHaveBeenCalled()
    expect(authService.updateProfile).not.toHaveBeenCalled()
  })

  test('未同意授权时点头像：只留本地预览，不上传云存储', async () => {
    wx.requirePrivacyAuthorize = jest.fn(({ fail }) => fail(new Error('deny')))
    const inst = open()
    inst.onChooseAvatar({ detail: { avatarUrl: 'wxfile://x.png' } })
    await flushPromises()
    expect(inst.data.avatarTempPath).toBe('wxfile://x.png')
    expect(inst.data.uploading).toBe(false)
    expect(authService.uploadAvatar).not.toHaveBeenCalled()
  })

  test('查看《隐私保护指引》走 openPrivacyContract，成功时不额外提示', async () => {
    wx.openPrivacyContract = jest.fn(({ success }) => success())
    const inst = open()
    await inst.tapPrivacyContract()
    expect(wx.openPrivacyContract).toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test('老基础库没有 openPrivacyContract -> 一句可操作的提示，不静默失败', async () => {
    delete wx.openPrivacyContract
    const inst = open()
    await inst.tapPrivacyContract()
    expect(wx.showToast).toHaveBeenCalledWith({
      title: '当前微信版本过低，无法查看指引',
      icon: 'none'
    })
  })
})
