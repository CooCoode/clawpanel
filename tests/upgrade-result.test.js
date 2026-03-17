import test from 'node:test'
import assert from 'node:assert/strict'

import { parseUpgradeResultForModal } from '../src/lib/upgrade-result.js'

test('多行升级结果应拆分日志并提取完成摘要', () => {
  const raw = [
    '📦 尝试 standalone 独立安装包',
    '查询最新版本...',
    '✅ standalone 安装完成 (2026.3.13-zh.1)',
    '✅ standalone (CDN) 安装完成',
  ].join('\n')

  const parsed = parseUpgradeResultForModal(raw, '操作完成')

  assert.deepEqual(parsed.logLines, [
    '📦 尝试 standalone 独立安装包',
    '查询最新版本...',
    '✅ standalone 安装完成 (2026.3.13-zh.1)',
    '✅ standalone (CDN) 安装完成',
  ])
  assert.equal(parsed.doneMessage, '✅ standalone (CDN) 安装完成')
})

test('空升级结果应回退默认完成文案', () => {
  const parsed = parseUpgradeResultForModal('', '升级完成')
  assert.deepEqual(parsed.logLines, [])
  assert.equal(parsed.doneMessage, '升级完成')
})

test('对象 message 字段应可被解析', () => {
  const parsed = parseUpgradeResultForModal({ message: '安装完成' }, '操作完成')
  assert.deepEqual(parsed.logLines, ['安装完成'])
  assert.equal(parsed.doneMessage, '安装完成')
})
