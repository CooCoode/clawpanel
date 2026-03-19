import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'package-web.sh')

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawpanel-package-web-'))
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture',
    private: true,
    scripts: { build: 'echo build' },
  }, null, 2))
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<html></html>')
  fs.writeFileSync(path.join(root, 'scripts', 'serve.js'), 'console.log("serve")\n')
  fs.writeFileSync(path.join(root, 'scripts', 'dev-api.js'), 'console.log("api")\n')
  return root
}

function cleanupFixture(root) {
  fs.rmSync(root, { recursive: true, force: true })
}

test('package:web 命令应指向 scripts/package-web.sh', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts?.['package:web'], 'bash scripts/package-web.sh')
  assert.equal(fs.existsSync(SCRIPT_PATH), true)
})

test('package-web.sh: 自动构建并生成只包含最小运行包的 clawpanel.zip', () => {
  const scriptSource = fs.readFileSync(SCRIPT_PATH, 'utf8')
  const fixture = makeFixture()
  try {
    const fixtureScriptPath = path.join(fixture, 'scripts', 'package-web.sh')
    fs.writeFileSync(fixtureScriptPath, scriptSource)
    fs.chmodSync(fixtureScriptPath, 0o755)

    const fakeBin = path.join(fixture, 'fake-bin')
    fs.mkdirSync(fakeBin, { recursive: true })
    const npmLogPath = path.join(fixture, 'npm-args.txt')
    fs.writeFileSync(path.join(fakeBin, 'npm'), `#!/bin/sh\necho "$@" > "${npmLogPath}"\nexit 0\n`)
    fs.chmodSync(path.join(fakeBin, 'npm'), 0o755)

    fs.writeFileSync(path.join(fixture, 'clawpanel.zip'), 'stale')

    const runResult = spawnSync('bash', [fixtureScriptPath], {
      cwd: fixture,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
      encoding: 'utf8',
    })

    assert.equal(runResult.status, 0, runResult.stderr || runResult.stdout)
    assert.equal(fs.readFileSync(npmLogPath, 'utf8').trim(), 'run build')

    const zipPath = path.join(fixture, 'clawpanel.zip')
    assert.equal(fs.existsSync(zipPath), true)
    assert.notEqual(fs.readFileSync(zipPath, 'utf8').slice(0, 5), 'stale')

    const listResult = spawnSync('unzip', ['-l', zipPath], { encoding: 'utf8' })
    assert.equal(listResult.status, 0, listResult.stderr || listResult.stdout)
    assert.match(listResult.stdout, /dist\/index\.html/)
    assert.match(listResult.stdout, /package\.json/)
    assert.match(listResult.stdout, /scripts\/serve\.js/)
    assert.match(listResult.stdout, /scripts\/dev-api\.js/)
    assert.doesNotMatch(listResult.stdout, /README\.md/)
    assert.match(runResult.stdout, /clawpanel\.zip/)
    assert.match(runResult.stdout, /scp/)
    assert.match(runResult.stdout, /pm2/)
  } finally {
    cleanupFixture(fixture)
  }
})
