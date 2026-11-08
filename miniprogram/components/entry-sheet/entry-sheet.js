/**
 * entry-sheet — 记一笔弹层（详细设计 6.2.5 / v1.7）
 * 语义：向目标成员「支出」一笔输赢流水（付款人恒为当前用户，方向与权限由页面保证）。
 * 纯展示 + 本地金额状态：addEntry 请求、clientRequestId 幂等键、错误文案均由页面持有并回填。
 * 根节点 wx:if 使弹层每次打开时 amount-input 重建，输入不残留上一笔。
 * 组件不访问网络、不持有全局状态。
 */

Component({
  properties: {
    visible: { type: Boolean, value: false },
    // 目标成员（被点击头像的好友）
    nickname: { type: String, value: '' },
    avatarFileID: { type: String, value: '' },
    // 提交中：禁用输入与按钮，防重复提交；此期间关闭也应被页面忽略
    submitting: { type: Boolean, value: false },
    // 保存失败文案（弹层保留，重试复用页面的同一幂等键）
    errorText: { type: String, value: '' }
  },

  data: {
    amountCents: 0
  },

  methods: {
    onAmountChange(e) {
      this.setData({ amountCents: (e.detail && e.detail.valueCents) || 0 })
    },

    onConfirm() {
      if (this.data.submitting || !this.data.amountCents) return
      this.triggerEvent('confirm', { valueCents: this.data.amountCents })
    },

    onClose() {
      this.triggerEvent('close')
    }
  }
})
