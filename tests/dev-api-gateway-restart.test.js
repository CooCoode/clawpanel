import test from 'node:test'
import assert from 'node:assert/strict'

import { restartGatewayWithRecovery, runGatewayMacFallback } from '../scripts/dev-api.js'

test('重启后已运行时不需要 fallback', () => {
  let fallbackCalled = 0
  let checks = 0

  const result = restartGatewayWithRecovery({
    runRestart: () => {},
    checkRunning: () => {
      checks += 1
      return checks >= 2
    },
    startFallback: () => { fallbackCalled += 1 },
    sleep: () => {},
    attempts: 3,
  })

  assert.equal(result, true)
  assert.equal(fallbackCalled, 0)
})

test('重启后未运行时触发 fallback 并恢复', () => {
  let fallbackCalled = 0
  let checks = 0

  const result = restartGatewayWithRecovery({
    runRestart: () => {},
    checkRunning: () => {
      checks += 1
      if (fallbackCalled === 0) return false
      return checks >= 4
    },
    startFallback: () => { fallbackCalled += 1 },
    sleep: () => {},
    attempts: 3,
  })

  assert.equal(result, true)
  assert.equal(fallbackCalled, 1)
})

test('重启与 fallback 后仍未运行时必须抛错', () => {
  assert.throws(() => restartGatewayWithRecovery({
    runRestart: () => {},
    checkRunning: () => false,
    startFallback: () => {},
    sleep: () => {},
    attempts: 2,
  }), /Gateway 未启动成功/)
})

test('mac fallback: plist 缺失时先安装再走服务启动', () => {
  let hasPlist = false
  let installCalled = 0
  let serviceCalled = 0
  let directCalled = 0

  const mode = runGatewayMacFallback({
    hasPlist: () => hasPlist,
    installService: () => { installCalled += 1; hasPlist = true },
    startViaService: () => { serviceCalled += 1 },
    startDirect: () => { directCalled += 1 },
  })

  assert.equal(mode, 'service')
  assert.equal(installCalled, 1)
  assert.equal(serviceCalled, 1)
  assert.equal(directCalled, 0)
})

test('mac fallback: 安装失败时回退直接启动', () => {
  let directCalled = 0

  const mode = runGatewayMacFallback({
    hasPlist: () => false,
    installService: () => { throw new Error('install failed') },
    startViaService: () => {},
    startDirect: () => { directCalled += 1 },
  })

  assert.equal(mode, 'direct')
  assert.equal(directCalled, 1)
})
