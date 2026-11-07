/**
 * settlement-list — 结算净额列表（详细设计 6.3）
 * 正红负绿之外，符号（+/-）始终写入文本，零显示灰色 ¥0.00。
 * 金额格式化复用 shared/money，不复制规则；组件不访问网络。
 */

const { formatCents } = require('../../shared/money')

const MAX_NAME_LEN = 12

function truncateName(name) {
  const text = String(name || '')
  if (text.length <= MAX_NAME_LEN) return text
  return text.slice(0, MAX_NAME_LEN - 1) + '…'
}

/** 净额 → 展示行（signedText 自带符号，tone 仅用于配色） */
function toRow(item) {
  const total = Number.isInteger(item.totalCents) ? item.totalCents : 0
  return {
    openid: item.openid,
    displayName: truncateName(item.nickname || item.openid),
    isOwner: Boolean(item.isOwner),
    signedText: formatCents(total, { sign: 'always', currency: true }),
    tone: total > 0 ? 'plus' : total < 0 ? 'minus' : 'zero'
  }
}

Component({
  properties: {
    // [{ openid, nickname, totalCents, isOwner? }]
    items: {
      type: Array,
      value: [],
      observer(next) {
        this.refresh(next)
      }
    }
  },

  data: {
    rows: []
  },

  lifetimes: {
    attached() {
      this.refresh(this.data.items)
    }
  },

  methods: {
    refresh(items) {
      const list = Array.isArray(items) ? items : []
      this.setData({ rows: list.map(toRow) })
    }
  }
})
