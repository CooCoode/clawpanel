import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createMemoryService } from '../scripts/dev-api.js'

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawpanel-memory-'))
  const openclawDir = path.join(root, '.openclaw')
  const mainWorkspace = path.join(root, 'main-workspace')
  const alphaWorkspace = path.join(openclawDir, 'agents', 'alpha', 'workspace')

  fs.mkdirSync(openclawDir, { recursive: true })
  fs.mkdirSync(mainWorkspace, { recursive: true })

  const config = {
    agents: {
      defaults: { workspace: mainWorkspace },
      list: [
        { id: 'main', workspace: mainWorkspace },
        { id: 'alpha' },
      ],
    },
  }
  fs.writeFileSync(path.join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2))

  return { root, openclawDir, mainWorkspace, alphaWorkspace }
}

function cleanupFixture(root) {
  fs.rmSync(root, { recursive: true, force: true })
}

test('listMemoryFiles: 分类目录、递归规则与 agentId 兼容', () => {
  const fx = makeFixture()
  try {
    fs.mkdirSync(path.join(fx.mainWorkspace, 'memory', 'sub'), { recursive: true })
    fs.writeFileSync(path.join(fx.mainWorkspace, 'memory', 'today.md'), '# today')
    fs.writeFileSync(path.join(fx.mainWorkspace, 'memory', 'sub', 'plan.txt'), 'todo')
    fs.writeFileSync(path.join(fx.mainWorkspace, 'memory', 'skip.log'), 'x')

    fs.mkdirSync(path.join(fx.root, 'workspace-memory', '2026'), { recursive: true })
    fs.writeFileSync(path.join(fx.root, 'workspace-memory', '2026', 'summary.md'), 'archive')

    fs.mkdirSync(path.join(fx.mainWorkspace, 'nested'), { recursive: true })
    fs.writeFileSync(path.join(fx.mainWorkspace, 'AGENTS.md'), 'core')
    fs.writeFileSync(path.join(fx.mainWorkspace, 'profile.json'), '{}')
    fs.writeFileSync(path.join(fx.mainWorkspace, 'nested', 'inner.md'), 'nope')

    const memory = createMemoryService({ openclawDir: fx.openclawDir })

    assert.deepEqual(memory.listMemoryFiles({ category: 'memory', agentId: 'main' }), ['sub/plan.txt', 'today.md'])
    assert.deepEqual(memory.listMemoryFiles({ category: 'archive', agent_id: 'main' }), ['2026/summary.md'])
    assert.deepEqual(memory.listMemoryFiles({ category: 'core', agentId: 'main' }), ['AGENTS.md', 'profile.json'])
  } finally {
    cleanupFixture(fx.root)
  }
})

test('write/read/delete: 按分类写入并可跨分类读取与删除', () => {
  const fx = makeFixture()
  try {
    const memory = createMemoryService({ openclawDir: fx.openclawDir })

    memory.writeMemoryFile({ path: 'note.md', content: 'hello', category: 'archive', agentId: 'main' })
    const archivePath = path.join(fx.root, 'workspace-memory', 'note.md')
    assert.equal(fs.existsSync(archivePath), true)
    assert.equal(memory.readMemoryFile({ path: 'note.md', agent_id: 'main' }), 'hello')

    memory.deleteMemoryFile({ path: 'note.md', agentId: 'main' })
    assert.equal(fs.existsSync(archivePath), false)

    memory.writeMemoryFile({ path: 'alpha.md', content: 'agent', category: 'memory', agent_id: 'alpha' })
    const alphaPath = path.join(fx.alphaWorkspace, 'memory', 'alpha.md')
    assert.equal(fs.existsSync(alphaPath), true)
  } finally {
    cleanupFixture(fx.root)
  }
})

test('exportMemoryZip: Web 端返回可下载 zip 数据', () => {
  const fx = makeFixture()
  try {
    fs.mkdirSync(path.join(fx.mainWorkspace, 'memory'), { recursive: true })
    fs.writeFileSync(path.join(fx.mainWorkspace, 'memory', 'pack.md'), 'zip me')

    const memory = createMemoryService({ openclawDir: fx.openclawDir })
    const result = memory.exportMemoryZip({ category: 'memory', agentId: 'main' })

    assert.equal(typeof result, 'object')
    assert.equal(result.mimeType, 'application/zip')
    assert.match(result.filename, /^openclaw-memory-\d{8}-\d{6}\.zip$/)

    const zipBuffer = Buffer.from(result.dataBase64, 'base64')
    assert.equal(zipBuffer.subarray(0, 4).toString('hex'), '504b0304')
    assert.equal(zipBuffer.includes(Buffer.from('pack.md')), true)
  } finally {
    cleanupFixture(fx.root)
  }
})
