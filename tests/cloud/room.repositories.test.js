/**
 * room 云函数真实仓储（repositories.js）事务路径回归测试
 *
 * 背景：fake-repos 的内存事务不校验 update 数据，曾放过一个线上 bug——
 * appendMember 将含 `_id` 的整文档回写事务 update，真实云数据库直接抛原生错误，
 * join 演变为 5001「服务异常」。本套件用 mock db 复刻该拒绝行为，守护仓储层契约。
 *
 * 用例编号：ROOM-REP-xx
 */

const { createRepositories } = require('../../cloudfunctions/room/repositories')
const { MAX_MEMBERS } = require('../../shared/constants')

function makeRoom(overrides = {}) {
  return {
    _id: 'r_1',
    name: '',
    inviteCode: '8234',
    ownerOpenid: 'o_owner',
    memberOpenids: ['o_owner'],
    members: [{ openid: 'o_owner', joinedAt: 1000 }],
    status: 'active',
    createdByRequestId: 'req-1',
    createdAt: 1000,
    updatedAt: 1000,
    endedAt: null,
    ...overrides
  }
}

/**
 * 模拟云数据库事务：
 * - doc.get 返回深拷贝（事务内读取快照）
 * - update data 携带 _id 时抛错（真实 wx-server-sdk 行为）
 * - opts.failUpdate：update 必抛错（模拟任意原生 DB 失败）
 * - opts.failRollback：rollback 自身抛错，验证不掩盖原始异常
 */
function makeTxDb(roomDoc, opts = {}) {
  const calls = { updates: [], commits: 0, rollbacks: 0 }
  const transaction = {
    collection() {
      return {
        doc() {
          return {
            get: async () => (roomDoc ? { data: JSON.parse(JSON.stringify(roomDoc)) } : { data: null }),
            update: async ({ data }) => {
              calls.updates.push(data)
              if (opts.failUpdate) throw new Error('errCode: -1 模拟原生 DB 更新失败')
              if (Object.prototype.hasOwnProperty.call(data, '_id')) {
                throw new Error('errCode: -1 DB 修改数据失败: _id 不应出现在更新数据中')
              }
              return { stats: { updated: 1 } }
            }
          }
        }
      }
    },
    commit: async () => {
      calls.commits++
    },
    rollback: async () => {
      calls.rollbacks++
      if (opts.failRollback) throw new Error('rollback fail: transaction already finished')
    }
  }
  const db = {
    startTransaction: async () => transaction,
    // 顶层集合接口：本套件只走事务路径，提供惰性链式 stub 即可满足构造
    collection: () => {
      const chain = {
        where: () => chain,
        and: () => chain,
        orderBy: () => chain,
        skip: () => chain,
        limit: () => chain,
        get: async () => ({ data: [] }),
        doc: () => chain,
        update: async () => ({ stats: { updated: 0 } }),
        remove: async () => ({ stats: { removed: 0 } })
      }
      return chain
    }
  }
  return { db, calls }
}

function repoWith(roomDoc, opts) {
  const { db, calls } = makeTxDb(roomDoc, opts)
  return { repo: createRepositories(db, {}), calls }
}

describe('cloudfunctions/room/repositories 事务', () => {
  describe('appendMember', () => {
    test('ROOM-REP-01 新成员加入：update 数据仅含变更字段、不含 _id，并 commit', async () => {
      const { repo, calls } = repoWith(makeRoom())
      const result = await repo.appendMember('r_1', 'o_new', 2000)

      expect(result.status).toBe('joined')
      expect(calls.updates).toHaveLength(1)
      const data = calls.updates[0]
      expect(Object.prototype.hasOwnProperty.call(data, '_id')).toBe(false)
      expect(Object.keys(data).sort()).toEqual(['lastActivityAt', 'memberOpenids', 'members', 'updatedAt'])
      expect(data.memberOpenids).toEqual(['o_owner', 'o_new'])
      expect(data.members).toEqual([
        { openid: 'o_owner', joinedAt: 1000 },
        { openid: 'o_new', joinedAt: 2000 }
      ])
      expect(data.updatedAt).toBe(2000)
      expect(data.lastActivityAt).toBe(2000) // v2.6：加入即活跃
      expect(calls.commits).toBe(1)
      // 返回体仍带 _id 供 handler 生成摘要
      expect(result.room._id).toBe('r_1')
    })

    test('ROOM-REP-02 已是成员：只读回滚，不 update 不 commit', async () => {
      const { repo, calls } = repoWith(makeRoom())
      const result = await repo.appendMember('r_1', 'o_owner', 2000)

      expect(result.status).toBe('already-member')
      expect(calls.updates).toHaveLength(0)
      expect(calls.commits).toBe(0)
      expect(calls.rollbacks).toBe(1)
    })

    test('ROOM-REP-03 已结束牌局：返回 ended，拒绝加入', async () => {
      const { repo, calls } = repoWith(makeRoom({ status: 'ended' }))
      const result = await repo.appendMember('r_1', 'o_new', 2000)

      expect(result.status).toBe('ended')
      expect(calls.commits).toBe(0)
    })

    test('ROOM-REP-04 满员：返回 full', async () => {
      const openids = Array.from({ length: MAX_MEMBERS }, (_, i) => `o_${i}`)
      const { repo, calls } = repoWith(makeRoom({ memberOpenids: openids }))
      const result = await repo.appendMember('r_1', 'o_new', 2000)

      expect(result.status).toBe('full')
      expect(calls.commits).toBe(0)
    })

    test('ROOM-REP-05 update 抛原生错误：原始异常上抛，且 rollback 自身失败不掩盖它', async () => {
      const { repo, calls } = repoWith(makeRoom(), { failUpdate: true, failRollback: true })
      await expect(repo.appendMember('r_1', 'o_new', 2000)).rejects.toThrow('模拟原生 DB 更新失败')
      expect(calls.rollbacks).toBe(1)
    })
  })

  describe('endRoom', () => {
    test('ROOM-REP-06 结束牌局：update 数据为 status/endedAt/updatedAt/endReason + 归档邀请码，不含 _id（v2.0 释放数字码位）', async () => {
      const { repo, calls } = repoWith(makeRoom())
      const result = await repo.endRoom('r_1', 5000)

      expect(result.status).toBe('ended')
      expect(calls.updates).toHaveLength(1)
      expect(Object.prototype.hasOwnProperty.call(calls.updates[0], '_id')).toBe(false)
      expect(Object.keys(calls.updates[0]).sort()).toEqual([
        'endReason',
        'endedAt',
        'inviteCode',
        'status',
        'updatedAt'
      ])
      expect(calls.updates[0].inviteCode).toBe('E:r_1')
      expect(calls.updates[0].endReason).toBe('owner') // v2.6：缺省房主手动
      expect(result.room._id).toBe('r_1')
      expect(calls.commits).toBe(1)
    })

    test('ROOM-REP-06b v2.6：reason=idle 时 endReason 落库为 idle（供详情页标注自动结束）', async () => {
      const { repo, calls } = repoWith(makeRoom())
      const result = await repo.endRoom('r_1', 5000, 'idle')
      expect(calls.updates[0].endReason).toBe('idle')
      expect(result.room.endReason).toBe('idle')
    })

    test('ROOM-REP-07 重复结束：返回 already-ended，回滚不提交', async () => {
      const { repo, calls } = repoWith(makeRoom({ status: 'ended', endedAt: 4000 }))
      const result = await repo.endRoom('r_1', 5000)

      expect(result.status).toBe('already-ended')
      expect(calls.updates).toHaveLength(0)
      expect(calls.rollbacks).toBe(1)
    })
  })
})
