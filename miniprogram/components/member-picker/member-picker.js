/**
 * member-picker — 成员选择（详细设计 6.3）
 * 展示头像/昵称/房主标识；排除 excludeOpenid（收款人选择时排除付款人）；
 * 选中项通过文本符号（✓）区分，不仅靠颜色。纯展示组件，不访问网络。
 */

const MAX_NAME_LEN = 10

/** 长昵称截断（保留符号语义，超出加省略号） */
function truncateName(name) {
  const text = String(name || '')
  if (text.length <= MAX_NAME_LEN) return text
  return text.slice(0, MAX_NAME_LEN - 1) + '…'
}

Component({
  properties: {
    // [{ openid, nickname, avatarFileID, isOwner }]
    members: {
      type: Array,
      value: [],
      observer() {
        this.refresh()
      }
    },
    // 当前选中的 openid
    valueOpenid: {
      type: String,
      value: '',
      observer() {
        this.refresh()
      }
    },
    // 需要从选项中排除的 openid（如已选付款人）
    excludeOpenid: {
      type: String,
      value: '',
      observer() {
        this.refresh()
      }
    },
    label: { type: String, value: '' }
  },

  data: {
    options: []
  },

  lifetimes: {
    attached() {
      this.refresh()
    }
  },

  methods: {
    refresh() {
      const members = Array.isArray(this.data.members) ? this.data.members : []
      const exclude = this.data.excludeOpenid
      const value = this.data.valueOpenid
      const options = members
        .filter((m) => m && m.openid && m.openid !== exclude)
        .map((m) => ({
          openid: m.openid,
          displayName: truncateName(m.nickname || m.openid),
          avatar: m.avatarFileID || '',
          isOwner: Boolean(m.isOwner),
          selected: m.openid === value
        }))
      if (JSON.stringify(options) === JSON.stringify(this.data.options)) return
      this.setData({ options })
    },

    onSelect(e) {
      const openid =
        (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.openid) || ''
      if (!openid) return
      this.triggerEvent('change', { openid })
    }
  }
})
