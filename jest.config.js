/**
 * Jest 配置 — 统一入口（npm test / npx jest 均读取本文件）
 * 组件测试通过文件头 `@jest-environment jsdom` 声明 DOM 环境，其余保持 node。
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'shared/**/*.js',
    'cloudfunctions/**/handlers.js',
    'miniprogram/services/**/*.js',
    'miniprogram/components/**/*.js'
  ]
}
