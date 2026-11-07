/**
 * 权限判定单元测试 — M3
 */

const { canViewRoom, canAddEntry, canEndRoom, canInvite, canDeleteRoom } = require('../../shared/permissions')

const activeRoom = {
  _id: 'room1',
  name: 'Test Room',
  ownerOpenid: 'owner_openid',
  memberOpenids: ['owner_openid', 'member_openid'],
  status: 'active'
}

const endedRoom = {
  ...activeRoom,
  status: 'ended'
}

describe('canViewRoom', () => {
  test('M3-01 非成员查看 -> false', () => {
    expect(canViewRoom('stranger', activeRoom)).toBe(false)
  })
  test('M3-02 成员查看 -> true', () => {
    expect(canViewRoom('member_openid', activeRoom)).toBe(true)
  })
  test('已结束牌局成员可查 -> true', () => {
    expect(canViewRoom('member_openid', endedRoom)).toBe(true)
  })
  test('room=null -> false', () => {
    expect(canViewRoom('member_openid', null)).toBe(false)
  })
  test('openid="" -> false', () => {
    expect(canViewRoom('', activeRoom)).toBe(false)
  })
})

describe('canAddEntry', () => {
  test('M3-03 成员新增流水，进行中 -> true', () => {
    expect(canAddEntry('member_openid', activeRoom)).toBe(true)
  })
  test('M3-04 成员新增流水，已结束 -> false', () => {
    expect(canAddEntry('member_openid', endedRoom)).toBe(false)
  })
  test('非成员 -> false', () => {
    expect(canAddEntry('stranger', activeRoom)).toBe(false)
  })
})

describe('canEndRoom', () => {
  test('M3-05 房主结束牌局，进行中 -> true', () => {
    expect(canEndRoom('owner_openid', activeRoom)).toBe(true)
  })
  test('M3-06 成员结束牌局 -> false', () => {
    expect(canEndRoom('member_openid', activeRoom)).toBe(false)
  })
  test('M3-07 房主结束已结束牌局 -> false', () => {
    expect(canEndRoom('owner_openid', endedRoom)).toBe(false)
  })
})

describe('canInvite', () => {
  test('M3-08 成员邀请，进行中 -> true', () => {
    expect(canInvite('member_openid', activeRoom)).toBe(true)
  })
  test('M3-09 成员邀请，已结束 -> false', () => {
    expect(canInvite('member_openid', endedRoom)).toBe(false)
  })
  test('非成员邀请 -> false', () => {
    expect(canInvite('stranger', activeRoom)).toBe(false)
  })
})

describe('canDeleteRoom', () => {
  test('M3-10 房主删除，进行中 -> false（v1.5：须先结束）', () => {
    expect(canDeleteRoom('owner_openid', activeRoom)).toBe(false)
  })
  test('M3-11 房主删除，已结束 -> true（历史清理）', () => {
    expect(canDeleteRoom('owner_openid', endedRoom)).toBe(true)
  })
  test('M3-12 成员删除 -> false', () => {
    expect(canDeleteRoom('member_openid', activeRoom)).toBe(false)
  })
  test('成员删除已结束牌局 -> false', () => {
    expect(canDeleteRoom('member_openid', endedRoom)).toBe(false)
  })
  test('非成员删除 -> false', () => {
    expect(canDeleteRoom('stranger', activeRoom)).toBe(false)
  })
})

describe('异常输入', () => {
  test('room=null 所有函数返回 false', () => {
    expect(canViewRoom('oid', null)).toBe(false)
    expect(canAddEntry('oid', null)).toBe(false)
    expect(canEndRoom('oid', null)).toBe(false)
    expect(canInvite('oid', null)).toBe(false)
    expect(canDeleteRoom('oid', null)).toBe(false)
  })
  test('openid="" 所有函数返回 false', () => {
    expect(canViewRoom('', activeRoom)).toBe(false)
    expect(canAddEntry('', activeRoom)).toBe(false)
    expect(canEndRoom('', activeRoom)).toBe(false)
    expect(canInvite('', activeRoom)).toBe(false)
    expect(canDeleteRoom('', activeRoom)).toBe(false)
  })
})
