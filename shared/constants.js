/**
 * 共享常量 — 客户端与云函数共用
 */

/** @type {number} 最大成员数（v2.0 起产品上限：一张麻将桌 4 家 + 轮休 3 位） */
exports.MAX_MEMBERS = 7

/** @type {number} 单笔金额上限（分），1,000,000 元 */
exports.MAX_AMOUNT_CENTS = 100000000

/** @type {number} 牌局列表每页条数 */
exports.PAGE_SIZE_ROOMS = 20

/** @type {number} 流水列表每页条数 */
exports.PAGE_SIZE_ENTRIES = 20

/** @type {number} 邀请码长度（v2.0 起 4 位，纯数字） */
exports.INVITE_CODE_LENGTH = 4

/** @type {string} 邀请码字符集（v2.0 起纯数字，便于牌桌上口头传码；旧 6 位字母数字码已停用） */
exports.INVITE_CODE_ALPHABET = '0123456789'

/** @type {number} 预留：番数下限 */
exports.FAN_MIN = 0

/** @type {number} 预留：番数上限 */
exports.FAN_MAX = 10

/** @type {number} 预留：倍率计算基数 */
exports.FAN_MULTIPLIER_BASE = 2

// 牌局状态
exports.ROOM_STATUS_ACTIVE = 'active'
exports.ROOM_STATUS_ENDED = 'ended'

/** @type {number} v2.6：闲置自动结束阈值——无新增流水且无新成员加入达 7 天 */
exports.IDLE_AUTO_END_MS = 7 * 24 * 60 * 60 * 1000

/** @type {number} v2.6：闲置扫描单轮最多处理的进行中场次（最闲置者优先，余量下轮再扫） */
exports.IDLE_AUTO_END_BATCH = 50

/** @type {object} v2.6：结束原因 */
exports.END_REASON_OWNER = 'owner' // 房主手动结束（v2.6 前的历史数据同此口径）
exports.END_REASON_IDLE = 'idle' // 系统因闲置自动结束

// 数据库集合名
exports.COLLECTION_USERS = 'users'
exports.COLLECTION_ROOMS = 'rooms'
exports.COLLECTION_ENTRIES = 'entries'
