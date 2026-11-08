/**
 * 静态资源引用 — 仅客户端展示用（sync:shared 不含 config，不进云函数）
 */

/**
 * 用户未上传头像时的默认头像（v2.4，微信式灰蓝底白色小人，miniprogram/images/default-avatar.png）。
 * 纯展示兜底：云端 avatarFileID 仍存空串，仅前端渲染处替换；资料页不受影响
 * （其「选择头像」占位是操作引导，不是他人视角的头像展示）。
 */
exports.DEFAULT_AVATAR_PATH = '/images/default-avatar.png'
