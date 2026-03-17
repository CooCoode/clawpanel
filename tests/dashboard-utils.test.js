import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeVersionInfo } from '../src/lib/dashboard-utils.js'

test('normalizeVersionInfo: null 应兜底为空对象', () => {
  assert.deepEqual(normalizeVersionInfo(null), {})
})

test('normalizeVersionInfo: 非对象值应兜底为空对象', () => {
  assert.deepEqual(normalizeVersionInfo('1.2.3'), {})
  assert.deepEqual(normalizeVersionInfo(123), {})
})

test('normalizeVersionInfo: 对象应原样返回', () => {
  const input = { current: '1.0.0', recommended: '1.1.0' }
  assert.equal(normalizeVersionInfo(input), input)
})
