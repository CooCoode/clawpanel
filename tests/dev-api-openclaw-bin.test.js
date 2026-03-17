import test from 'node:test'
import assert from 'node:assert/strict'

import { buildOpenclawBinCandidatesForUnix } from '../scripts/dev-api.js'

test('Unix 候选路径应包含 standalone 安装目录', () => {
  const home = '/tmp/clawpanel-test-home'
  const candidates = buildOpenclawBinCandidatesForUnix(home)

  assert.ok(candidates.includes('/opt/homebrew/bin/openclaw'))
  assert.ok(candidates.includes('/usr/local/bin/openclaw'))
  assert.ok(candidates.includes(`${home}/.openclaw-bin/openclaw`))
})
