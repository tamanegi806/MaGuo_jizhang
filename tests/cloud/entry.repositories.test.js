/**
 * entry 云函数真实仓储（repositories.js）数据路径回归测试
 *
 * 两条钉死的契约（都源自真实云数据库的限制，内存 fake repo 无法暴露）：
 * 1) **事务内不得写 rooms 文档**（v2.6 修正）：云开发事务「读快照、写才加事务锁」，
 *    同牌局两人并发记账时，若事务里 update 房间，后提交方会拿到
 *    DATABASE_TRANSACTION_CONFLICT，而 startTransaction 不自动重试 -> 整笔回滚 ->
 *    用户看到 5001「服务异常」且流水丢失。活跃时间改由事务提交后的 bumpActivity 单文档更新。
 * 2) **update 数据不得携带整文档（含 _id）**：与 appendMember 的 `_id` 事故同类，
 *    真实库直接抛原生错误。
 *
 * 用例编号：ENTRY-REP-xx
 */

const { createRepositories } = require('../../cloudfunctions/entry/repositories')

function makeTxDb(roomDoc, opts = {}) {
  const calls = {
    txAdds: [], // 事务内插入的流水
    txUpdates: [], // 事务内对文档的 update（v2.6 修正后应为空）
    plainUpdates: [], // 非事务的 collection().doc().update
    commits: 0,
    rollbacks: 0
  }
  const transaction = {
    collection(name) {
      if (name === 'entries') {
        return {
          add: async ({ data }) => {
            calls.txAdds.push(data)
            if (opts.failAdd) throw new Error('duplicate key for clientRequestId index')
            return { _id: 'e_1' }
          }
        }
      }
      return {
        doc() {
          return {
            get: async () => (roomDoc ? { data: JSON.parse(JSON.stringify(roomDoc)) } : { data: null }),
            update: async ({ data }) => {
              calls.txUpdates.push({ name, data })
              throw new Error(`事务内不应写 ${name} 文档（并发记账会撞事务写冲突）`)
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
    }
  }
  const db = {
    startTransaction: async () => transaction,
    collection(name) {
      const docRef = {
        get: async () => (roomDoc && name === 'rooms' ? { data: JSON.parse(JSON.stringify(roomDoc)) } : { data: null }),
        update: async ({ data }) => {
          calls.plainUpdates.push({ name, data })
          if (opts.failPlainUpdate) throw new Error('errCode: -502001 获取文档锁超时')
          if (Object.prototype.hasOwnProperty.call(data, '_id')) {
            throw new Error('errCode: -1 DB 修改数据失败: _id 不应出现在更新数据中')
          }
          return { stats: { updated: 1 } }
        }
      }
      const chain = {
        where: () => chain,
        orderBy: () => chain,
        skip: () => chain,
        limit: () => chain,
        get: async () => ({ data: [] }),
        doc: () => docRef
      }
      return chain
    }
  }
  return { db, calls }
}

const META = { roomId: 'r_1', clientRequestId: 'req-1', createdBy: 'o_a', createdAt: 5000 }
const OK_ROOM = { _id: 'r_1', status: 'active', memberOpenids: ['o_a', 'o_b'] }
const validateOk = () => ({ fromOpenid: 'o_a', toOpenid: 'o_b', amountCents: 100 })

describe('cloudfunctions/entry/repositories 事务与活跃时间推进', () => {
  test('ENTRY-REP-01 记账成功：事务只读房间 + 插流水，不写 rooms 文档（并发记账防写冲突）', async () => {
    const { db, calls } = makeTxDb(OK_ROOM)
    const repo = createRepositories(db, {})
    const res = await repo.createAtomically(META, validateOk)

    expect(res.status).toBe('created')
    expect(calls.txAdds).toHaveLength(1)
    expect(calls.txUpdates).toHaveLength(0) // 事务内一旦写 rooms，mock db 直接抛错
    expect(calls.commits).toBe(1)
    expect(calls.rollbacks).toBe(0)
  })

  test('ENTRY-REP-02 bumpActivity：非事务单文档更新，仅 lastActivityAt/updatedAt 两字段且不含 _id', async () => {
    const { db, calls } = makeTxDb(OK_ROOM)
    const repo = createRepositories(db, {})
    await repo.bumpActivity('r_1', 5000)

    expect(calls.plainUpdates).toHaveLength(1)
    expect(calls.plainUpdates[0].name).toBe('rooms')
    expect(Object.keys(calls.plainUpdates[0].data).sort()).toEqual(['lastActivityAt', 'updatedAt'])
    expect(calls.plainUpdates[0].data.lastActivityAt).toBe(5000)
    expect(calls.plainUpdates[0].data.updatedAt).toBe(5000) // 与活跃时间同基准，保证扫描顺序与判据同向
  })

  test('ENTRY-REP-03 bumpActivity 失败（锁超时/原生错误）原样上抛，由 handlers 决定容忍', async () => {
    const { db } = makeTxDb(OK_ROOM, { failPlainUpdate: true })
    const repo = createRepositories(db, {})
    await expect(repo.bumpActivity('r_1', 5000)).rejects.toThrow('获取文档锁超时')
  })

  test('ENTRY-REP-04 幂等重放（唯一索引冲突）：走 duplicate，不提交', async () => {
    const { db, calls } = makeTxDb(OK_ROOM, { failAdd: true })
    const repo = createRepositories(db, {})
    const res = await repo.createAtomically(META, validateOk)
    expect(res.status).toBe('duplicate')
    expect(calls.txUpdates).toHaveLength(0)
    expect(calls.commits).toBe(0)
  })

  test('ENTRY-REP-05 房间不存在：not-found，无插入', async () => {
    const { db, calls } = makeTxDb(null)
    const repo = createRepositories(db, {})
    const res = await repo.createAtomically(META, validateOk)
    expect(res.status).toBe('not-found')
    expect(calls.txAdds).toHaveLength(0)
    expect(calls.rollbacks).toBe(1)
  })
})
