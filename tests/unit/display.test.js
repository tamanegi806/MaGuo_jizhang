/**
 * 展示层工具与用户域规则单元测试
 */

const { formatDateTime, formatClock } = require('../../miniprogram/utils/date')
const { tempNickname, NICKNAME_MAX_LEN } = require('../../shared/user')
const { friendlyMessage } = require('../../miniprogram/utils/error-message')
const { ErrorCodes } = require('../../shared/errors')

describe('utils/date', () => {
  test('formatDateTime 完整格式', () => {
    const ts = new Date(2026, 0, 5, 9, 8).getTime()
    expect(formatDateTime(ts)).toBe('2026-01-05 09:08')
  })

  test('formatClock 仅时分', () => {
    const ts = new Date(2026, 10, 7, 21, 30).getTime()
    expect(formatClock(ts)).toBe('21:30')
  })

  test.each([[0], [-1], [null], [undefined], ['123'], [NaN]])('非法输入 %p -> 空串', (v) => {
    expect(formatDateTime(v)).toBe('')
    expect(formatClock(v)).toBe('')
  })
})

describe('shared/user tempNickname', () => {
  test('取 openid 后 4 位', () => {
    expect(tempNickname('o_me_1234abcd')).toBe('玩家abcd')
  })

  test('短 openid 原样拼接', () => {
    expect(tempNickname('ab')).toBe('玩家ab')
  })

  test('空值兜底', () => {
    expect(tempNickname('')).toBe('玩家')
    expect(tempNickname(null)).toBe('玩家')
  })

  test('昵称长度上限与 auth 校验一致', () => {
    expect(NICKNAME_MAX_LEN).toBe(20)
  })
})

describe('utils/error-message friendlyMessage', () => {
  test.each([
    [ErrorCodes.UNAUTHENTICATED, '登录已失效，请重试'],
    [ErrorCodes.PROFILE_INCOMPLETE, '请先完善昵称'],
    [ErrorCodes.ROOM_NOT_FOUND, '牌局不存在或已被删除'],
    [ErrorCodes.ROOM_ENDED, '牌局已结束，数据仅可查看'],
    [ErrorCodes.NOT_ROOM_MEMBER, '你不在该牌局中'],
    [ErrorCodes.NOT_ROOM_OWNER, '只有房主可以操作'],
    [ErrorCodes.INVALID_INVITE_CODE, '邀请码无效，请向好友确认'],
    [ErrorCodes.INVALID_INVITE_CODE_FORMAT, '邀请码应为 6 位字母或数字'],
    [ErrorCodes.SAME_PAYER_PAYEE, '付款人和收款人不能是同一人'],
    [ErrorCodes.INVALID_AMOUNT, '请输入大于 0 的金额'],
    [ErrorCodes.INVALID_MEMBER, '成员选择无效，请重新选择'],
    [ErrorCodes.QR_GENERATE_FAILED, '小程序码生成失败'],
    [ErrorCodes.INTERNAL_ERROR, '服务异常，请稍后再试']
  ])('code %p -> %p', (code, text) => {
    expect(friendlyMessage({ code, message: 'RAW_ENUM' })).toBe(text)
  })

  test('网络异常字符串 code', () => {
    expect(friendlyMessage({ code: 'NETWORK_ERROR', message: '网络异常，请检查连接' })).toBe(
      '网络异常，请检查连接'
    )
  })

  test('内部枚举名不外泄', () => {
    expect(friendlyMessage({ code: 9999, message: 'SOMETHING_WEIRD' })).toBe('操作失败，请重试')
  })

  test('可读 message 透传', () => {
    expect(friendlyMessage({ message: '自定义可读提示' })).toBe('自定义可读提示')
  })

  test('空错误兜底', () => {
    expect(friendlyMessage(null)).toBe('操作失败，请重试')
    expect(friendlyMessage(undefined)).toBe('操作失败，请重试')
  })

  test('ROOM_FULL 含动态人数', () => {
    expect(friendlyMessage({ code: ErrorCodes.ROOM_FULL })).toMatch(/人数已满/)
  })
})
