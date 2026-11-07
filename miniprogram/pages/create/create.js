/**
 * 创建牌局（详细设计 6.2.2 / 7.2）
 * 首次提交生成 clientRequestId，失败重试复用；成功跳详情并自动打开邀请弹层。
 */

const roomService = require('../../services/room-service')
const { uuidv4 } = require('../../utils/uuid')
const { friendlyMessage } = require('../../utils/error-message')

const NAME_MAX_LEN = 30

Page({
  data: {
    name: '',
    nameError: '',
    clientRequestId: '',
    submitting: false,
    error: null // { code, message }
  },

  onInputName(e) {
    this.setData({ name: e.detail.value, nameError: '' })
  },

  async onSubmit() {
    if (this.data.submitting) return
    const name = (this.data.name || '').trim()
    if (!name) {
      this.setData({ nameError: '请输入牌局名称' })
      return
    }
    if (name.length > NAME_MAX_LEN) {
      this.setData({ nameError: `名称最多 ${NAME_MAX_LEN} 个字` })
      return
    }

    // 幂等键：首次提交生成，重试复用同一个值
    let clientRequestId = this.data.clientRequestId
    if (!clientRequestId) {
      clientRequestId = uuidv4()
      this.setData({ clientRequestId })
    }

    this.setData({ submitting: true, error: null })
    try {
      const res = await roomService.createRoom({ name, clientRequestId })
      this.setData({ submitting: false })
      const roomId = res && res.room ? res.room.roomId : ''
      wx.redirectTo({ url: `/pages/room/room?id=${roomId}&openInvite=1` })
    } catch (err) {
      // 保留输入与 clientRequestId，用户可直接重试
      this.setData({ submitting: false, error: { code: err.code, message: friendlyMessage(err) } })
    }
  }
})
