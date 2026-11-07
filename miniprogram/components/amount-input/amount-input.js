/**
 * amount-input — 正数金额输入（详细设计 6.3）
 * 内部输入元字符串，复用 shared/money 的 parseYuanToCents 校验；
 * 合法且大于 0 时触发 change({ valueCents })，非法只显示错误、不触发变更。
 * 组件不访问网络、不持有全局状态。
 */

const { parseYuanToCents, formatCents } = require('../../shared/money')

Component({
  properties: {
    // 外部回填值（单位：分）。>0 时显示为元
    value: {
      type: Number,
      value: 0,
      observer(next) {
        this.syncFromValue(next)
      }
    },
    disabled: { type: Boolean, value: false },
    placeholder: { type: String, value: '输入金额（元）' }
  },

  data: {
    text: '',
    errorText: ''
  },

  lifetimes: {
    attached() {
      this.syncFromValue(this.data.value)
    }
  },

  methods: {
    /**
     * 外部 value（分）变化时同步输入框文本
     * @param {number} cents
     */
    syncFromValue(cents) {
      if (!Number.isInteger(cents)) return
      if (cents === 0) {
        if (this.data.text === '' && this.data.errorText === '') return
        this.setData({ text: '', errorText: '' })
        return
      }
      const text = formatCents(cents, { sign: 'none' })
      const errorText = cents > 0 ? '' : '金额必须大于 0'
      if (this.data.text === text && this.data.errorText === errorText) return
      this.setData({ text, errorText })
    },

    /**
     * 输入事件：实时解析并触发 change / 错误提示
     * @param {{detail: {value: string}}} e
     */
    onInput(e) {
      const raw = e.detail && e.detail.value !== undefined ? String(e.detail.value) : ''
      const parsed = this.parse(raw)
      if (raw === '' && parsed.error === '') {
        this.setData({ text: raw, errorText: '' })
        return
      }
      this.setData({ text: raw, errorText: parsed.error })
      if (parsed.valueCents !== null) {
        this.triggerEvent('change', { valueCents: parsed.valueCents })
      }
    },

    /**
     * 解析元字符串（复用 shared 规则，不复制校验逻辑）
     * @param {string} raw
     * @returns {{valueCents: number|null, error: string}}
     */
    parse(raw) {
      const trimmed = raw.trim()
      if (trimmed === '') {
        return { valueCents: null, error: '' }
      }
      try {
        const cents = parseYuanToCents(trimmed)
        if (cents <= 0) {
          return { valueCents: null, error: '金额必须大于 0' }
        }
        return { valueCents: cents, error: '' }
      } catch (err) {
        return { valueCents: null, error: '请输入正确的金额（最多两位小数）' }
      }
    },

    /**
     * 失焦时再次校验并规范化展示
     * @param {{detail: {value: string}}} e
     */
    onBlur(e) {
      const raw = e.detail && e.detail.value !== undefined ? String(e.detail.value) : ''
      const parsed = this.parse(raw)
      if (parsed.valueCents !== null) {
        this.setData({
          text: formatCents(parsed.valueCents, { sign: 'none' }),
          errorText: ''
        })
        this.triggerEvent('change', { valueCents: parsed.valueCents })
      } else {
        this.setData({ errorText: parsed.error })
      }
    }
  }
})
