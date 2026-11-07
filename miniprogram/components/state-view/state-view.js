/**
 * state-view — 统一加载/空/错误态（详细设计 6.3）
 * 页面接入：
 *   <state-view type="{{status}}" text="{{statusText}}" bind:retry="onRetry" />
 * status ∈ 'loading' | 'empty' | 'error'；error 态提供重试入口（事件 retry）。
 * 组件不访问网络。
 */

const DEFAULT_TEXT = {
  loading: '加载中…',
  empty: '暂无数据',
  error: '加载失败，请重试'
}

Component({
  properties: {
    // loading / empty / error
    type: {
      type: String,
      value: 'loading',
      observer() {
        this.refresh()
      }
    },
    text: {
      type: String,
      value: '',
      observer() {
        this.refresh()
      }
    }
  },

  data: {
    displayText: DEFAULT_TEXT.loading
  },

  lifetimes: {
    attached() {
      this.refresh()
    }
  },

  methods: {
    refresh() {
      const type = DEFAULT_TEXT[this.data.type] ? this.data.type : 'empty'
      const displayText = this.data.text || DEFAULT_TEXT[type]
      if (this.data.displayText === displayText) return
      this.setData({ displayText })
    },

    onRetry() {
      this.triggerEvent('retry')
    }
  }
})
