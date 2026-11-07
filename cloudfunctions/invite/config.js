/**
 * invite 云函数运行配置
 */

/**
 * 小程序码 envVersion：release / trial / develop
 * 部署环境可通过环境变量覆盖；默认发布版
 */
exports.ENV_VERSION = process.env.MINIAPP_ENV_VERSION || 'release'
