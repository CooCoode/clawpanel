import test from 'node:test'
import assert from 'node:assert/strict'

import { ensurePluginTrustedConfig, isPluginAlreadyExistsErrorText, getQqbotPluginPackageCandidates } from '../scripts/dev-api.js'

test('plugin already exists 文本应识别为可忽略安装错误', () => {
  const text = 'plugin already exists: /Users/r002/.openclaw/extensions/qqbot (delete it first)'
  assert.equal(isPluginAlreadyExistsErrorText(text), true)
})

test('ensurePluginTrustedConfig: 自动补齐 allow 与 enabled', () => {
  const cfg = {}
  const changed = ensurePluginTrustedConfig(cfg, 'qqbot')

  assert.equal(changed, true)
  assert.deepEqual(cfg.plugins.allow, ['qqbot'])
  assert.equal(cfg.plugins.entries.qqbot.enabled, true)
})

test('ensurePluginTrustedConfig: 已有配置时保持幂等不重复', () => {
  const cfg = {
    plugins: {
      allow: ['qqbot'],
      entries: {
        qqbot: { enabled: true },
      },
    },
  }
  const changed = ensurePluginTrustedConfig(cfg, 'qqbot')
  assert.equal(changed, false)
  assert.deepEqual(cfg.plugins.allow, ['qqbot'])
  assert.equal(cfg.plugins.entries.qqbot.enabled, true)
})

test('QQ 插件安装包应优先使用腾讯官方包', () => {
  const candidates = getQqbotPluginPackageCandidates()
  assert.ok(Array.isArray(candidates) && candidates.length > 0)
  assert.equal(candidates[0], '@tencent-connect/openclaw-qqbot@latest')
})
