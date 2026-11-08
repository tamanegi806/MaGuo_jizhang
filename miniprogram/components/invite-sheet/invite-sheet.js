/**
 * invite-sheet — 邀请卡弹层（详细设计 6.2.7）
 * 纯展示：邀请卡（牌局名/状态/成员头像堆叠/小程序码/邀请码）+ 复制与转发入口；
 * 网络请求（生成二维码）与剪贴板操作（复制）由页面处理后回填 props，组件不访问网络。
 * 二维码失败不影响邀请码复制与转发（CMP-07）。
 * 样式仅复用 app.wxss 的 CSS 变量（自定义组件不继承 app.wxss 的类选择器）。
 */

const DEFAULT_QR_ERROR = '小程序码加载失败'
const MAX_FACES = 5 // 头像堆叠最多展示数，其余计入「+N」

Component({
  properties: {
    visible: { type: Boolean, value: false },
    inviteCode: { type: String, value: '' },
    qrFileID: { type: String, value: '' },
    qrLoading: { type: Boolean, value: false },
    roomName: { type: String, value: '' },
    memberCount: { type: Number, value: 0 },
    members: {
      type: Array,
      value: [],
      observer() {
        this.syncFaces()
      }
    },
    qrError: {
      type: String,
      value: '',
      observer(next) {
        this.setData({ errorText: next || DEFAULT_QR_ERROR })
      }
    }
  },

  data: {
    errorText: DEFAULT_QR_ERROR,
    faces: [], // [{ key, avatarFileID }] 最多 MAX_FACES 个
    moreCount: 0 // 未展示的成员数
  },

  lifetimes: {
    attached() {
      if (this.data.qrError) {
        this.setData({ errorText: this.data.qrError })
      }
      this.syncFaces()
    }
  },

  methods: {
    /** 成员 -> 头像堆叠（前 MAX_FACES 个 + 剩余计数） */
    syncFaces() {
      const list = this.data.members || []
      const faces = list.slice(0, MAX_FACES).map((m, i) => ({
        key: (m && m.openid) || `f_${i}`,
        avatarFileID: (m && m.avatarFileID) || ''
      }))
      // 剩余数以「成员数与列表数的较大值」为准，避免 memberCount 滞后时少报
      const total = Math.max(list.length, Number(this.data.memberCount) || 0)
      this.setData({ faces, moreCount: Math.max(total - MAX_FACES, 0) })
    },

    onClose() {
      this.triggerEvent('close')
    },

    onRetry() {
      this.triggerEvent('retry')
    },

    onCopyCode() {
      this.triggerEvent('copyCode', { code: this.data.inviteCode })
    }
  }
})
