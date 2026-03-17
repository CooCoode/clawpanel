import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ensurePluginTrustedConfig,
  isPluginAlreadyExistsErrorText,
  getQqbotPluginPackageCandidates,
  resolveChannelPluginIdForTrust,
  buildQqbotChannelAddArgs,
  readQqbotFormFromConfigEntry,
} from '../scripts/dev-api.js'

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

test('QQ 渠道插件信任 ID 应写为 openclaw-qqbot', () => {
  assert.equal(resolveChannelPluginIdForTrust('qqbot', {}), 'openclaw-qqbot')
})

test('QQ 保存应走 channels add 命令参数', () => {
  const args = buildQqbotChannelAddArgs({ appId: '1903558636', appSecret: 'secret' })
  assert.deepEqual(args, ['channels', 'add', '--channel', 'qqbot', '--token', '1903558636:secret'])
})

test('QQ 配置读取兼容 appId/clientSecret 结构', () => {
  const form = readQqbotFormFromConfigEntry({
    enabled: true,
    token: '',
    appId: '1903558636',
    clientSecret: 'secret',
  })
  assert.equal(form.appId, '1903558636')
  assert.equal(form.appSecret, 'secret')
})
