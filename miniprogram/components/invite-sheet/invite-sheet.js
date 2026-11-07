/**
 * invite-sheet — 邀请弹层（详细设计 6.3）
 * 纯展示：小程序码图片、邀请码、复制与转发入口；
 * 网络请求（生成二维码）与剪贴板操作（复制）由页面处理后回填 props。
 * 二维码失败不影响邀请码复制（CMP-07）。组件不访问网络。
 */

const DEFAULT_QR_ERROR = '小程序码加载失败'

Component({
  properties: {
    visible: { type: Boolean, value: false },
    inviteCode: { type: String, value: '' },
    qrFileID: { type: String, value: '' },
    qrLoading: { type: Boolean, value: false },
    qrError: {
      type: String,
      value: '',
      observer(next) {
        this.setData({ errorText: next || DEFAULT_QR_ERROR })
      }
    }
  },

  data: {
    errorText: DEFAULT_QR_ERROR
  },

  lifetimes: {
    attached() {
      if (this.data.qrError) {
        this.setData({ errorText: this.data.qrError })
      }
    }
  },

  methods: {
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
