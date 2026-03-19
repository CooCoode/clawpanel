import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import * as devApi from '../scripts/dev-api.js'

function makeFixture({ accessPassword = 'panel-secret', ignoreRisk = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawpanel-oauth-'))
  const openclawDir = path.join(root, '.openclaw')
  fs.mkdirSync(openclawDir, { recursive: true })
  fs.writeFileSync(path.join(openclawDir, 'clawpanel.json'), JSON.stringify({
    accessPassword,
    ...(ignoreRisk ? { ignoreRisk: true } : {}),
  }, null, 2))
  return { root, openclawDir }
}

function cleanupFixture(root) {
  fs.rmSync(root, { recursive: true, force: true })
}

function makeClock(seed = Date.parse('2026-03-19T00:00:00Z')) {
  let nowValue = seed
  return {
    now() { return nowValue },
    advance(ms) { nowValue += ms; return nowValue },
  }
}

function makeIdSource() {
  let seq = 0
  return () => `test-${++seq}`
}

function expectOauthError(fn, code) {
  assert.throws(fn, (err) => err && err.code === code)
}

test('createOAuthService: client_credentials 返回 access token 与 refresh token', () => {
  assert.equal(typeof devApi.createOAuthService, 'function')
  const fx = makeFixture()
  try {
    const clock = makeClock()
    const nextId = makeIdSource()
    const oauth = devApi.createOAuthService({
      openclawDir: fx.openclawDir,
      now: () => clock.now(),
      randomId: nextId,
      randomToken: (prefix) => `${prefix}_${nextId()}`,
    })

    const client = oauth.createClient({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      name: 'Deploy Controller',
    })
    const issued = oauth.issueClientCredentials({
      clientId: client.clientId,
      clientSecret: 'deploy-secret',
      scope: 'panel:admin',
    })

    assert.equal(issued.tokenType, 'Bearer')
    assert.equal(issued.expiresIn, 3600)
    assert.equal(issued.scope, 'panel:admin')
    assert.match(issued.accessToken, /^cpat_/)
    assert.match(issued.refreshToken, /^cprt_/)

    const auth = oauth.authenticateBearer(issued.accessToken)
    assert.equal(auth?.clientId, 'deploy-controller')
    assert.equal(auth?.scope, 'panel:admin')

    const state = JSON.parse(fs.readFileSync(path.join(fx.openclawDir, 'clawpanel-oauth.json'), 'utf8'))
    assert.equal(state.clients.length, 1)
    assert.equal(state.accessTokens.length, 1)
    assert.equal(state.refreshTokens.length, 1)
    assert.equal(state.clients[0].secretHash.includes('deploy-secret'), false)
    assert.equal(state.accessTokens[0].tokenHash.includes(issued.accessToken), false)
    assert.equal(state.refreshTokens[0].tokenHash.includes(issued.refreshToken), false)
  } finally {
    cleanupFixture(fx.root)
  }
})

test('createOAuthService: refresh_token 轮换后旧 refresh token 失效', () => {
  assert.equal(typeof devApi.createOAuthService, 'function')
  const fx = makeFixture()
  try {
    const clock = makeClock()
    const nextId = makeIdSource()
    const oauth = devApi.createOAuthService({
      openclawDir: fx.openclawDir,
      now: () => clock.now(),
      randomId: nextId,
      randomToken: (prefix) => `${prefix}_${nextId()}`,
    })

    oauth.createClient({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      name: 'Deploy Controller',
    })
    const issued = oauth.issueClientCredentials({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      scope: 'panel:admin',
    })
    const refreshed = oauth.refreshAccessToken({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      refreshToken: issued.refreshToken,
    })

    assert.notEqual(refreshed.accessToken, issued.accessToken)
    assert.notEqual(refreshed.refreshToken, issued.refreshToken)
    assert.equal(refreshed.scope, 'panel:admin')
    expectOauthError(() => oauth.refreshAccessToken({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      refreshToken: issued.refreshToken,
    }), 'invalid_grant')
  } finally {
    cleanupFixture(fx.root)
  }
})

test('createOAuthService: bootstrap 首次导入成功并自动删除源文件，重复导入不覆盖', () => {
  assert.equal(typeof devApi.createOAuthService, 'function')
  const fx = makeFixture()
  try {
    const bootstrapPath = path.join(fx.openclawDir, 'clawpanel-oauth-bootstrap.json')
    fs.writeFileSync(bootstrapPath, JSON.stringify({
      clients: [{
        clientId: 'deploy-controller',
        clientSecret: 'bootstrap-secret-a',
        name: 'Deploy Controller',
        enabled: true,
      }],
    }, null, 2))

    const oauth = devApi.createOAuthService({ openclawDir: fx.openclawDir, now: () => Date.parse('2026-03-19T00:00:00Z') })
    const first = oauth.importBootstrapClients()
    assert.deepEqual(first.importedClientIds, ['deploy-controller'])
    assert.equal(fs.existsSync(bootstrapPath), false)

    oauth.issueClientCredentials({
      clientId: 'deploy-controller',
      clientSecret: 'bootstrap-secret-a',
      scope: 'panel:admin',
    })

    fs.writeFileSync(bootstrapPath, JSON.stringify({
      clients: [{
        clientId: 'deploy-controller',
        clientSecret: 'bootstrap-secret-b',
        name: 'Deploy Controller Updated',
        enabled: true,
      }],
    }, null, 2))

    const second = devApi.createOAuthService({ openclawDir: fx.openclawDir, now: () => Date.parse('2026-03-20T00:00:00Z') })
    const repeated = second.importBootstrapClients()
    assert.deepEqual(repeated.importedClientIds, [])
    assert.equal(fs.existsSync(bootstrapPath), false)
    second.issueClientCredentials({
      clientId: 'deploy-controller',
      clientSecret: 'bootstrap-secret-a',
      scope: 'panel:admin',
    })
    expectOauthError(() => second.issueClientCredentials({
      clientId: 'deploy-controller',
      clientSecret: 'bootstrap-secret-b',
      scope: 'panel:admin',
    }), 'invalid_client')
  } finally {
    cleanupFixture(fx.root)
  }
})

test('createApiAccessController: Bearer 可访问业务接口，但 session-only 接口必须要求面板会话', () => {
  assert.equal(typeof devApi.createOAuthService, 'function')
  assert.equal(typeof devApi.createApiAccessController, 'function')
  const fx = makeFixture()
  try {
    const oauth = devApi.createOAuthService({ openclawDir: fx.openclawDir, now: () => Date.parse('2026-03-19T00:00:00Z') })
    oauth.createClient({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      name: 'Deploy Controller',
    })
    const issued = oauth.issueClientCredentials({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      scope: 'panel:admin',
    })
    const access = devApi.createApiAccessController({ oauthService: oauth })

    const bearerAllowed = access.authorize({
      cmd: 'get_services_status',
      sessionAuthenticated: false,
      bearerToken: issued.accessToken,
    })
    assert.equal(bearerAllowed.ok, true)
    assert.equal(bearerAllowed.method, 'bearer')
    assert.equal(bearerAllowed.clientId, 'deploy-controller')

    const bearerDenied = access.authorize({
      cmd: 'write_panel_config',
      sessionAuthenticated: false,
      bearerToken: issued.accessToken,
    })
    assert.equal(bearerDenied.ok, false)
    assert.equal(bearerDenied.code, 'AUTH_REQUIRED')

    const sessionAllowed = access.authorize({
      cmd: 'write_panel_config',
      sessionAuthenticated: true,
      bearerToken: null,
    })
    assert.equal(sessionAllowed.ok, true)
    assert.equal(sessionAllowed.method, 'session')
  } finally {
    cleanupFixture(fx.root)
  }
})

test('createOAuthService: 无访问密码时 OAuth 禁用', () => {
  assert.equal(typeof devApi.createOAuthService, 'function')
  const fx = makeFixture({ accessPassword: 'panel-secret' })
  try {
    const oauth = devApi.createOAuthService({ openclawDir: fx.openclawDir, now: () => Date.parse('2026-03-19T00:00:00Z') })
    oauth.createClient({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      name: 'Deploy Controller',
    })
    fs.writeFileSync(path.join(fx.openclawDir, 'clawpanel.json'), JSON.stringify({ ignoreRisk: true }, null, 2))
    const disabled = devApi.createOAuthService({ openclawDir: fx.openclawDir, now: () => Date.parse('2026-03-20T00:00:00Z') })

    expectOauthError(() => disabled.issueClientCredentials({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      scope: 'panel:admin',
    }), 'access_denied')
  } finally {
    cleanupFixture(fx.root)
  }
})

test('createOAuthService: invalid_scope 与 unsupported_grant_type 返回标准 OAuth 错误码', () => {
  assert.equal(typeof devApi.createOAuthService, 'function')
  const fx = makeFixture()
  try {
    const oauth = devApi.createOAuthService({ openclawDir: fx.openclawDir, now: () => Date.parse('2026-03-19T00:00:00Z') })
    oauth.createClient({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      name: 'Deploy Controller',
    })

    expectOauthError(() => oauth.exchangeToken({
      grantType: 'client_credentials',
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      scope: 'panel:read',
    }), 'invalid_scope')
    expectOauthError(() => oauth.exchangeToken({
      grantType: 'authorization_code',
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
    }), 'unsupported_grant_type')
  } finally {
    cleanupFixture(fx.root)
  }
})

test('createOAuthService: access token 与 refresh token 过期或撤销后必须失效', () => {
  assert.equal(typeof devApi.createOAuthService, 'function')
  const fx = makeFixture()
  try {
    const clock = makeClock()
    const oauth = devApi.createOAuthService({ openclawDir: fx.openclawDir, now: () => clock.now() })
    oauth.createClient({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      name: 'Deploy Controller',
    })

    const issued = oauth.issueClientCredentials({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      scope: 'panel:admin',
    })
    assert.equal(oauth.authenticateBearer(issued.accessToken)?.clientId, 'deploy-controller')

    oauth.revokeToken({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      token: issued.accessToken,
    })
    assert.equal(oauth.authenticateBearer(issued.accessToken), null)

    const next = oauth.issueClientCredentials({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      scope: 'panel:admin',
    })
    clock.advance((3600 * 1000) + 1)
    assert.equal(oauth.authenticateBearer(next.accessToken), null)
    clock.advance((30 * 24 * 60 * 60 * 1000) + 1)
    expectOauthError(() => oauth.refreshAccessToken({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      refreshToken: next.refreshToken,
    }), 'invalid_grant')
  } finally {
    cleanupFixture(fx.root)
  }
})

test('createOAuthService: 禁用或删除 client 后现有 access/refresh token 必须全部失效', () => {
  assert.equal(typeof devApi.createOAuthService, 'function')
  const fx = makeFixture()
  try {
    const oauth = devApi.createOAuthService({ openclawDir: fx.openclawDir, now: () => Date.parse('2026-03-19T00:00:00Z') })
    oauth.createClient({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      name: 'Deploy Controller',
    })

    const first = oauth.issueClientCredentials({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      scope: 'panel:admin',
    })
    oauth.setClientEnabled({ clientId: 'deploy-controller', enabled: false })
    assert.equal(oauth.authenticateBearer(first.accessToken), null)
    expectOauthError(() => oauth.refreshAccessToken({
      clientId: 'deploy-controller',
      clientSecret: 'deploy-secret',
      refreshToken: first.refreshToken,
    }), 'invalid_client')

    oauth.setClientEnabled({ clientId: 'deploy-controller', enabled: true })
    const second = oauth.rotateClientSecret({ clientId: 'deploy-controller' })
    const rotated = oauth.issueClientCredentials({
      clientId: 'deploy-controller',
      clientSecret: second.clientSecret,
      scope: 'panel:admin',
    })
    oauth.deleteClient({ clientId: 'deploy-controller' })
    assert.equal(oauth.authenticateBearer(rotated.accessToken), null)
  } finally {
    cleanupFixture(fx.root)
  }
})
