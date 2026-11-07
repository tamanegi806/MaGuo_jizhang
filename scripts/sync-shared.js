#!/usr/bin/env node
/**
 * 共享代码同步脚本
 * 将 shared/ 目录同步到 miniprogram/shared/ 和各云函数目录的 shared/
 *
 * 用法: node scripts/sync-shared.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SHARED_SRC = path.join(ROOT, 'shared')
const MINIPROGRAM_DEST = path.join(ROOT, 'miniprogram', 'shared')
const CLOUDFUNCS_DIR = path.join(ROOT, 'cloudfunctions')

/**
 * 清空目标目录
 */
function emptyDir(dest) {
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true })
  }
  fs.mkdirSync(dest, { recursive: true })
}

/** 生成副本统一添加的标记（源码本身不应包含此行） */
const GENERATED_MARK = '/* !AUTO-GENERATED: 由 scripts/sync-shared.js 从 shared/ 同步生成，请勿直接编辑本文件 */\n'

/**
 * 递归复制目录
 */
function copyRecursive(src, dest) {
  const stats = fs.statSync(src)
  if (stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const filename of fs.readdirSync(src)) {
      copyRecursive(path.join(src, filename), path.join(dest, filename))
    }
  } else {
    let content = fs.readFileSync(src, 'utf8')
    if (!content.includes('AUTO-GENERATED')) {
      content = GENERATED_MARK + content
    }
    fs.writeFileSync(dest, content, 'utf8')
  }
}

function main() {
  console.log('🔄 Syncing shared/...')

  // 1. 复制到 miniprogram/shared/
  emptyDir(MINIPROGRAM_DEST)
  for (const filename of fs.readdirSync(SHARED_SRC)) {
    copyRecursive(path.join(SHARED_SRC, filename), path.join(MINIPROGRAM_DEST, filename))
  }
  console.log(`✅ synced to miniprogram/shared/`)

  // 2. 复制到每个云函数目录的 shared/
  //    同时合并 _shared/ 的内容
  const cloudSharedDest = path.join(CLOUDFUNCS_DIR, '_shared', '..', 'shared') // 基础 shared

  // 获取所有云函数目录
  const cloudFunctions = fs.readdirSync(CLOUDFUNCS_DIR).filter(f => {
    const fp = path.join(CLOUDFUNCS_DIR, f)
    return fs.statSync(fp).isDirectory() && f !== '_shared'
  })

  for (const funcName of cloudFunctions) {
    const dest = path.join(CLOUDFUNCS_DIR, funcName, 'shared')
    emptyDir(dest)
    // 复制 shared/* 到云函数 shared/
    for (const filename of fs.readdirSync(SHARED_SRC)) {
      copyRecursive(path.join(SHARED_SRC, filename), path.join(dest, filename))
    }
    // 复制 _shared/ 中的模块到云函数根目录（response, auth-guard 等）
    const sharedDir = path.join(CLOUDFUNCS_DIR, '_shared')
    if (fs.existsSync(sharedDir)) {
      for (const filename of fs.readdirSync(sharedDir)) {
        copyRecursive(path.join(sharedDir, filename), path.join(dest, filename))
      }
    }
    console.log(`✅ synced to cloudfunctions/${funcName}/shared/`)
  }

  console.log('✅ All done!')
}

main()
