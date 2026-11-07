/**
 * entry-card — 流水卡片（详细设计 6.3）
 * 展示「付款人 → 收款人」、金额、时间；点击触发 tap（catchtap 阻止原生冒泡，父级只收一次）。
 * 长昵称截断为固定长度加省略号；金额格式化复用 shared/money。组件不访问网络。
 */

const { formatCents } = require('../../shared/money')

const MAX_NAME_LEN = 8

function truncateName(name) {
  const text = String(name || '')
  if (text.length <= MAX_NAME_LEN) return text
  return text.slice(0, MAX_NAME_LEN - 1) + '…'
}

/** 毫秒时间戳 → 'MM-DD HH:mm'；无效返回 '' */
function formatTime(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return ''
  const d = new Date(ts)
  const pad = (n) => (n < 10 ? '0' + n : String(n))
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

Component({
  properties: {
    // 服务端 formatEntry 结果：{fromNickname,toNickname,amountCents,amountText,createdAt,...}
    entry: {
      type: Object,
      value: null,
      observer(next) {
        this.refresh(next)
      }
    }
  },

  data: {
    display: { from: '', to: '', amountText: '', timeText: '' }
  },

  lifetimes: {
    attached() {
      this.refresh(this.data.entry)
    }
  },

  methods: {
    refresh(entry) {
      if (!entry) {
        this.setData({ display: { from: '', to: '', amountText: '', timeText: '' } })
        return
      }
      const amountText =
        entry.amountText ||
        (Number.isInteger(entry.amountCents)
          ? formatCents(entry.amountCents, { currency: true })
          : '')
      this.setData({
        display: {
          from: truncateName(entry.fromNickname || entry.fromOpenid),
          to: truncateName(entry.toNickname || entry.toOpenid),
          amountText,
          timeText: formatTime(entry.createdAt)
        }
      })
    },

    onTap() {
      this.triggerEvent('tap', { entry: this.data.entry })
    }
  }
})
