/* !AUTO-GENERATED: 由 scripts/sync-shared.js 从 shared/ 同步生成，请勿直接编辑本文件 */
/**
 * 共享常量 — 客户端与云函数共用
 */

/** @type {number} 最大成员数 */
exports.MAX_MEMBERS = 100

/** @type {number} 单笔金额上限（分），1,000,000 元 */
exports.MAX_AMOUNT_CENTS = 100000000

/** @type {number} 牌局列表每页条数 */
exports.PAGE_SIZE_ROOMS = 20

/** @type {number} 流水列表每页条数 */
exports.PAGE_SIZE_ENTRIES = 20

/** @type {number} 邀请码长度 */
exports.INVITE_CODE_LENGTH = 6

/** @type {string} 邀请码字符集（排除 0 O 1 I 避免混淆） */
exports.INVITE_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** @type {number} 预留：番数下限 */
exports.FAN_MIN = 0

/** @type {number} 预留：番数上限 */
exports.FAN_MAX = 10

/** @type {number} 预留：倍率计算基数 */
exports.FAN_MULTIPLIER_BASE = 2

// 牌局状态
exports.ROOM_STATUS_ACTIVE = 'active'
exports.ROOM_STATUS_ENDED = 'ended'

// 数据库集合名
exports.COLLECTION_USERS = 'users'
exports.COLLECTION_ROOMS = 'rooms'
exports.COLLECTION_ENTRIES = 'entries'
