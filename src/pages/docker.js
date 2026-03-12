/**
 * Docker 集群管理页面
 * 管理 OpenClaw Docker 容器集群：节点管理、容器 CRUD、日志查看
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showConfirm } from '../components/modal.js'
import { icon } from '../lib/icons.js'
import { pixelRole, pixelBarracks } from '../lib/pixel-roles.js'
import { getActiveInstance, switchInstance, isInDocker } from '../lib/app-state.js'
import { renderSidebar } from '../components/sidebar.js'
import { reloadCurrentRoute } from '../router.js'
import { DOCKER_TASK_TIMEOUT_MS, buildDockerDispatchTargets, buildDockerInstanceSwitchContext } from '../lib/docker-tasking.js'

function esc(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtBytes(bytes) {
  if (!bytes) return '-'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB'
  return (bytes / 1073741824).toFixed(1) + ' GB'
}

// OpenClaw 容器识别
const OPENCLAW_PATTERNS = ['openclaw', 'qingchencloud']
function isOpenClawContainer(c) {
  const img = (c.image || '').toLowerCase()
  return OPENCLAW_PATTERNS.some(p => img.includes(p))
}

// 用户手动纳入管理的容器 ID 持久化
const ADOPTED_KEY = 'clawpanel_adopted_containers'
function getAdoptedIds() {
  try { return new Set(JSON.parse(localStorage.getItem(ADOPTED_KEY) || '[]')) }
  catch { return new Set() }
}
function saveAdoptedIds(ids) {
  localStorage.setItem(ADOPTED_KEY, JSON.stringify([...ids]))
}
function isManagedContainer(c) {
  return isOpenClawContainer(c) || getAdoptedIds().has(c.id)
}

// 军事化术语 & 兵种系统
const MILITARY = {
  roles: {
    general:    { iconName: 'shield', title: '步兵', desc: '通用作战', color: '#64748b' },
    coder:      { iconName: 'swords', title: '突击兵', desc: '编程突击', color: '#f59e0b' },
    translator: { iconName: 'globe', title: '翻译官', desc: '翻译作战', color: '#06b6d4' },
    writer:     { iconName: 'pen-tool', title: '文书官', desc: '写作任务', color: '#8b5cf6' },
    analyst:    { iconName: 'bar-chart', title: '参谋', desc: '数据分析', color: '#22c55e' },
    custom:     { iconName: 'gear', title: '特种兵', desc: '特殊任务', color: '#ef4444' },
  },
  // 从容器名推断兵种
  inferRole(name) {
    if (!name) return 'general'
    const n = name.toLowerCase()
    for (const r of ['coder', 'translator', 'writer', 'analyst', 'custom']) {
      if (n.includes(r)) return r
    }
    return 'general'
  },
}

// 兵种徽章内嵌 SVG 路径（24x24 viewBox，嵌入盾形内）
const BADGE_PATHS = {
  crown:     '<path d="M2 20h20L19 9l-5 5-2-7-2 7-5-5-3 11z"/><path d="M2 20h20v2H2z"/>',
  shield:    '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  swords:    '<path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6M16 16l4 4"/><path d="M14.5 6.5L18 3l3 3-3.5 3.5M20 4L8.5 15.5"/>',
  globe:     '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>',
  'pen-tool':'<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>',
  'bar-chart':'<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  gear:      '<circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
}

function roleBadgeSvg(role, size = 32) {
  const r = MILITARY.roles[role] || MILITARY.roles.general
  const badgePath = BADGE_PATHS[r.iconName] || BADGE_PATHS.shield
  return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="rb-${role}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${r.color}" stop-opacity=".9"/><stop offset="100%" stop-color="${r.color}" stop-opacity=".5"/></linearGradient></defs>
    <path d="M20 2 L36 10 L36 24 C36 32 28 38 20 38 C12 38 4 32 4 24 L4 10 Z" fill="url(#rb-${role})" stroke="${r.color}" stroke-width="1.5" opacity=".85"/>
    <g transform="translate(12,12) scale(0.667)" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${badgePath}</g>
  </svg>`
}

function roleIcon(role, size = 14) {
  const r = MILITARY.roles[role] || MILITARY.roles.general
  return icon(r.iconName, size)
}

let _refreshTimer = null
let _workspaceTimer = null
let _lastContainers = []

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="cluster-header">
      <div class="cluster-header-left">
        <h1 class="cluster-title">🦞 龙虾军团</h1>
        <div class="cluster-stats" id="cluster-stats"></div>
      </div>
      <div class="cluster-header-right">
        <button class="btn btn-sm" data-action="refresh">${icon('eye', 12)} 刷新</button>
      </div>
    </div>

    <div class="task-hub" id="task-hub">
      <div class="task-hub-bar">
        <div class="task-mode" id="task-mode">
          <button class="task-mode-btn active" data-mode="broadcast">${icon('radio', 12)} 全体广播</button>
          <button class="task-mode-btn" data-mode="smart">${icon('zap', 12)} 智能分配</button>
          <button class="task-mode-btn" data-mode="pick">${icon('list', 12)} 指定成员</button>
        </div>
      </div>
      <div class="task-pick-bar" id="task-pick" style="display:none"></div>
      <div class="task-beta-note">
        <span class="task-beta-icon">${icon('alert-triangle', 12)}</span>
        <span>测试功能，当前能力与稳定性仍在完善中。</span>
      </div>
      <div class="task-input-row">
        <textarea class="task-input" id="task-input" rows="1" placeholder="输入任务指令，分配给龙虾兵执行..."></textarea>
        <button class="task-send-btn" id="task-send" disabled>${icon('send', 16)}</button>
      </div>
    </div>

    <div class="task-workspace" id="task-workspace" style="display:none">
      <div class="workspace-header">
        <span class="workspace-title">${icon('activity', 14)} 异步工作区</span>
        <button class="btn btn-sm" data-action="workspace-clear">${icon('x', 12)} 清空历史</button>
      </div>
      <div class="workspace-workers" id="workspace-workers"></div>
      <div class="workspace-history" id="workspace-history"></div>
    </div>

    <div class="section-bar">
      <span class="section-title">${icon('swords', 14)} 兵力部署</span>
      <div class="section-actions">
        <div class="batch-actions" id="batch-actions" style="display:none">
          <label class="batch-select-all"><input type="checkbox" id="ct-select-all"/> 全选</label>
          <span class="batch-count" id="batch-count">0 已选</span>
          <button class="btn btn-sm batch-btn" data-action="batch-start" disabled>${icon('play', 12)} 出征</button>
          <button class="btn btn-sm batch-btn" data-action="batch-stop" disabled>${icon('stop', 12)} 休整</button>
          <button class="btn btn-sm batch-btn" data-action="batch-restart" disabled>${icon('refresh-cw', 12)} 整编</button>
          <button class="btn btn-sm batch-btn" data-action="batch-sync" disabled>${icon('upload', 12)} 同步配置</button>
          <button class="btn btn-sm batch-btn" data-action="batch-rebuild" disabled>${icon('hammer', 12)} 重建</button>
          <button class="btn btn-sm batch-btn danger" data-action="batch-remove" disabled>${icon('trash', 12)} 退役</button>
        </div>
      </div>
    </div>
    <div id="workers-grid"></div>

    <div class="section-bar" style="margin-top:var(--space-xl, 32px)">
      <span class="section-title">${icon('castle', 14)} 军营 <span id="infra-detail" class="infra-detail"></span></span>
    </div>
    <div id="docker-nodes"></div>
    <div id="docker-containers" style="margin-top:var(--space-md)"></div>
  `

  bindEvents(page)
  initTaskHub(page)
  await loadClusterOverview(page)

  _refreshTimer = setInterval(() => loadClusterOverview(page), 30000)
  return page
}

export function cleanup() {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null }
  if (_workspaceTimer) { clearInterval(_workspaceTimer); _workspaceTimer = null }
}

async function loadClusterOverview(page) {
  try {
    const nodes = await api.dockerClusterOverview()
    renderHeader(page, nodes)
    renderWorkers(page, nodes)
    renderNodes(page, nodes)
    renderOthers(page, nodes)
    updateTaskTargets(page, nodes)
    // 基础设施摘要
    const totalContainers = nodes.reduce((s, n) => s + (n.totalContainers || 0), 0)
    const runningContainers = nodes.reduce((s, n) => s + (n.runningContainers || 0), 0)
    const detail = page.querySelector('#infra-detail')
    if (detail) detail.textContent = `${nodes.length} 节点 · ${runningContainers} 运行 / ${totalContainers} 总计`
  } catch (e) {
    const errMsg = String(e.message || e)
    // 后端未运行（Tauri 桌面版不含 Docker 后端，或 Web 模式后端未启动）
    const isBackendMissing = errMsg.includes('后端服务未运行') || errMsg.includes('is not valid JSON') || errMsg.includes('<!DOCTYPE')
    const displayMsg = isBackendMissing ? 'Docker 管理后端未运行' : errMsg
    page.querySelector('#cluster-stats').innerHTML = `<span class="cluster-stat" style="color:var(--error,#ef4444)">${icon('x-circle', 12)} Docker 未连接: ${esc(displayMsg)}</span>`

    // ClawPanel 自身运行在 Docker 容器中时，显示容器内专属指引
    if (isInDocker()) {
      page.querySelector('#workers-grid').innerHTML = `
        <div class="docker-empty">
          <div class="docker-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><rect x="1" y="11" width="4" height="3" rx=".5"/><rect x="6" y="11" width="4" height="3" rx=".5"/><rect x="11" y="11" width="4" height="3" rx=".5"/><rect x="6" y="7" width="4" height="3" rx=".5"/><rect x="11" y="7" width="4" height="3" rx=".5"/><rect x="16" y="11" width="4" height="3" rx=".5"/><rect x="11" y="3" width="4" height="3" rx=".5"/><path d="M2 17c1 3 4 5 10 5s9-2 10-5"/></svg>
          </div>
          <div class="docker-empty-title">Docker 宿主机未连接</div>
          <div class="docker-empty-desc">ClawPanel 当前运行在 Docker 容器中，需要连接宿主机 Docker 守护进程才能管理龙虾军团。</div>
          <div class="docker-guide-section">
            <div class="docker-guide-title">${icon('gear', 14)} 连接宿主机 Docker</div>
            <ol>
              <li>确保宿主机 Docker 守护进程已开启 TCP 或 Unix Socket 访问</li>
              <li>挂载 Docker Socket：在 docker-compose.yml 中添加 <code style="font-size:11px">- /var/run/docker.sock:/var/run/docker.sock</code></li>
              <li>或在「军营」区域添加远程 Docker 节点（TCP 方式：<code style="font-size:11px">http://宿主机IP:2375</code>）</li>
              <li>重启容器后回到本页面点击「刷新」</li>
            </ol>
            <div style="margin-top:8px;font-size:12px;color:var(--text-tertiary)">龙虾军团功能用于在宿主机上部署和管理多个 OpenClaw 容器实例</div>
          </div>
        </div>
      `
      page.querySelector('#docker-nodes').innerHTML = ''
      page.querySelector('#docker-containers').innerHTML = ''
      return
    }

    // 后端缺失时显示专属指引（桌面版需要 Web 部署模式）
    if (isBackendMissing) {
      page.querySelector('#workers-grid').innerHTML = `
        <div class="docker-empty">
          <div class="docker-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><rect x="1" y="11" width="4" height="3" rx=".5"/><rect x="6" y="11" width="4" height="3" rx=".5"/><rect x="11" y="11" width="4" height="3" rx=".5"/><rect x="6" y="7" width="4" height="3" rx=".5"/><rect x="11" y="7" width="4" height="3" rx=".5"/><rect x="16" y="11" width="4" height="3" rx=".5"/><rect x="11" y="3" width="4" height="3" rx=".5"/><path d="M2 17c1 3 4 5 10 5s9-2 10-5"/></svg>
          </div>
          <div class="docker-empty-title">龙虾军团需要 Web 部署模式</div>
          <div class="docker-empty-desc">Docker 容器管理功能需要 ClawPanel Web 后端支持。桌面版暂不内置 Docker 管理后端。</div>
          <div class="docker-guide-section">
            <div class="docker-guide-title">${icon('info', 14)} 如何使用龙虾军团</div>
            <ol>
              <li>使用 Docker 部署 ClawPanel Web 版（推荐）：<code style="font-size:11px">docker run -d -p 3000:3000 -v /var/run/docker.sock:/var/run/docker.sock ghcr.io/qingchencloud/openclaw:latest</code></li>
              <li>或使用开发模式启动：<code style="font-size:11px">npm run dev</code>，后端会自动启动 Docker 管理服务</li>
              <li>确保 Docker Desktop 已安装并运行</li>
            </ol>
            <div style="margin-top:8px;font-size:12px;color:var(--text-tertiary)">桌面版的 Docker 管理功能正在开发中，敬请期待后续版本更新。</div>
          </div>
        </div>
      `
      page.querySelector('#docker-nodes').innerHTML = ''
      page.querySelector('#docker-containers').innerHTML = ''
      return
    }

    const isWin = navigator.userAgent.includes('Windows')
    const isMacOS = navigator.userAgent.includes('Mac')
    const installGuide = isWin
      ? `<div class="docker-guide-section">
          <div class="docker-guide-title">${icon('download', 14)} Windows 安装 Docker Desktop</div>
          <ol>
            <li>下载 <a href="https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" target="_blank" style="color:var(--accent)">Docker Desktop for Windows</a></li>
            <li>双击安装包，按提示完成安装（需要 WSL2 支持）</li>
            <li>安装完成后启动 Docker Desktop，等待右下角鲸鱼图标变绿</li>
            <li>回到本页面点击「刷新」</li>
          </ol>
          <div style="margin-top:8px;font-size:12px;color:var(--text-tertiary)">如已安装，请确认 Docker Desktop 已启动（右下角托盘图标）</div>
        </div>`
      : isMacOS
        ? `<div class="docker-guide-section">
            <div class="docker-guide-title">${icon('download', 14)} macOS 安装 Docker Desktop</div>
            <ol>
              <li>下载 <a href="https://desktop.docker.com/mac/main/arm64/Docker.dmg" target="_blank" style="color:var(--accent)">Docker Desktop for Mac (Apple Silicon)</a> 或 <a href="https://desktop.docker.com/mac/main/amd64/Docker.dmg" target="_blank" style="color:var(--accent)">Intel 版</a></li>
              <li>拖入 Applications 文件夹，启动 Docker Desktop</li>
              <li>等待菜单栏鲸鱼图标变为运行状态</li>
              <li>回到本页面点击「刷新」</li>
            </ol>
            <div style="margin-top:8px;font-size:12px;color:var(--text-tertiary)">也可通过 Homebrew 安装：<code style="font-size:11px">brew install --cask docker</code></div>
          </div>`
        : `<div class="docker-guide-section">
            <div class="docker-guide-title">${icon('download', 14)} Linux 安装 Docker</div>
            <ol>
              <li>一键安装：<code style="font-size:11px">curl -fsSL https://get.docker.com | sh</code></li>
              <li>将当前用户加入 docker 组：<code style="font-size:11px">sudo usermod -aG docker $USER</code></li>
              <li>重新登录后执行 <code style="font-size:11px">docker info</code> 验证</li>
              <li>回到本页面点击「刷新」</li>
            </ol>
            <div style="margin-top:8px;font-size:12px;color:var(--text-tertiary)">如已安装，确认 Docker 守护进程已启动：<code style="font-size:11px">sudo systemctl start docker</code></div>
          </div>`
    page.querySelector('#workers-grid').innerHTML = `
      <div class="docker-empty">
        <div class="docker-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><rect x="1" y="11" width="4" height="3" rx=".5"/><rect x="6" y="11" width="4" height="3" rx=".5"/><rect x="11" y="11" width="4" height="3" rx=".5"/><rect x="6" y="7" width="4" height="3" rx=".5"/><rect x="11" y="7" width="4" height="3" rx=".5"/><rect x="16" y="11" width="4" height="3" rx=".5"/><rect x="11" y="3" width="4" height="3" rx=".5"/><path d="M2 17c1 3 4 5 10 5s9-2 10-5"/></svg>
        </div>
        <div class="docker-empty-title">Docker 未连接</div>
        <div class="docker-empty-desc">${esc(e.message)}</div>
        ${installGuide}
      </div>
    `
    page.querySelector('#docker-nodes').innerHTML = ''
    page.querySelector('#docker-containers').innerHTML = ''
  }
}

function renderHeader(page, nodes) {
  const el = page.querySelector('#cluster-stats')
  let total = 0, running = 0
  for (const n of nodes) {
    if (!n.online || !n.containers) continue
    for (const c of n.containers) {
      if (isManagedContainer(c)) { total++; if (c.state === 'running') running++ }
    }
  }
  const stopped = total - running
  el.innerHTML = `
    <span class="cluster-stat"><span class="dot ${running > 0 ? 'online' : ''}"></span>${running} 在线</span>
    <span class="cluster-stat-sep">·</span>
    <span class="cluster-stat">${total} 兵力</span>
    ${stopped > 0 ? `<span class="cluster-stat-sep">·</span><span class="cluster-stat muted">${stopped} 休整</span>` : ''}
  `
}

function renderNodes(page, nodes) {
  const el = page.querySelector('#docker-nodes')
  let html = `
    <div class="docker-section-header">
      <div class="docker-section-title">${icon('castle', 16)} 军营</div>
      <div class="docker-section-actions">
        <button class="btn btn-primary btn-sm" data-action="add-node">${icon('plus-circle', 14)} 建立军营</button>
      </div>
    </div>
    <div class="docker-node-grid">
  `
  for (const node of nodes) {
    const statusClass = node.online ? 'online' : 'offline'
    const statusText = node.online ? '在线' : '离线'
    const mem = node.memory ? fmtBytes(node.memory) : '-'
    html += `
      <div class="docker-node-card ${statusClass}">
        <div class="docker-node-header">
          <div class="docker-node-pixel">${pixelBarracks(28)}</div>
          <div class="docker-node-status ${statusClass}"></div>
          <div class="docker-node-name">${esc(node.name)}</div>
          <div class="docker-node-badge">${statusText}</div>
          ${node.id !== 'local' ? `<button class="docker-node-remove" data-action="remove-node" data-node-id="${esc(node.id)}" title="移除节点">&times;</button>` : ''}
        </div>
        <div class="docker-node-info">
          <span>${esc(node.endpoint)}</span>
          ${node.online ? `<span>Docker ${esc(node.dockerVersion)}</span><span>${node.cpus || '-'} CPU · ${mem} RAM</span>` : `<span class="docker-node-error">${esc(node.error || '连接失败')}</span>`}
        </div>
        ${node.online ? `
          <div class="docker-node-footer">
            <span>${node.runningContainers || 0} 运行 / ${node.totalContainers || 0} 总计</span>
            <button class="btn btn-sm" data-action="deploy" data-node-id="${esc(node.id)}">🦞 征召龙虾</button>
          </div>
        ` : ''}
      </div>
    `
  }
  html += '</div>'
  el.innerHTML = html
}

function _parseHostPorts(portsStr) {
  const result = { panel: null, gateway: null }
  if (!portsStr) return result
  for (const seg of portsStr.split(/,\s*/)) {
    // 支持多种格式: "1421→1420", "1421->1420", "1421:1420", "0.0.0.0:1421->1420/tcp"
    const m = seg.match(/(\d+)\s*(?:→|->|:)\s*(\d+)/)
    if (!m) continue
    const hostPort = m[1], containerPort = m[2]
    if (containerPort === '1420') result.panel = hostPort
    else if (containerPort === '18789') result.gateway = hostPort
  }
  return result
}

function _renderUnitCard(c, showAdopt) {
  const isRunning = c.state === 'running'
  const stateClass = isRunning ? 'running' : 'stopped'
  const isAdopted = !isOpenClawContainer(c) && getAdoptedIds().has(c.id)
  const ports = _parseHostPorts(c.ports)
  const host = location.hostname || 'localhost'
  const role = MILITARY.inferRole(c.name)
  const roleInfo = MILITARY.roles[role]

  if (showAdopt) {
    return `<div class="unit-card enlist">
      <div class="unit-card-header">
        <div class="unit-badge">${roleBadgeSvg('general', 28)}</div>
        <div class="unit-identity">
          <div class="unit-name">${esc(c.name)}</div>
          <div class="unit-id">${esc(c.id)}</div>
        </div>
        <span class="unit-state ${stateClass}">${esc(c.status || c.state)}</span>
      </div>
      <div class="unit-card-footer">
        <span class="unit-image">${esc(c.image)}</span>
        <button class="btn btn-sm" data-action="adopt" data-ct="${esc(c.id)}" data-node="${esc(c.nodeId)}" data-name="${esc(c.name)}">编入军团</button>
      </div>
    </div>`
  }

  // 检查是否为当前管理的活跃实例
  const activeInst = getActiveInstance()
  const isActive = activeInst.type === 'docker' && activeInst.id === `docker-${c.id.slice(0, 12)}`

  return `<div class="unit-card ${stateClass}${isActive ? ' active-instance' : ''}" style="--unit-color:${roleInfo.color}">
    <div class="unit-card-select">
      <input type="checkbox" class="ct-select" data-ct="${esc(c.id)}" data-node="${esc(c.nodeId)}" data-state="${esc(c.state)}"/>
    </div>
    <div class="unit-card-header">
      <div class="unit-badge">${pixelRole(role, 36)}</div>
      <div class="unit-identity">
        <div class="unit-name">${esc(c.name)}</div>
        <div class="unit-role">${icon(roleInfo.iconName, 12)} ${roleInfo.title} — ${roleInfo.desc}</div>
      </div>
      ${isActive
        ? `<span class="unit-active-tag">${icon('monitor', 10)} 管理中</span>`
        : isRunning && ports.panel
          ? `<button class="btn btn-xs unit-switch-btn" data-action="switch-instance" data-ct="${esc(c.id)}" data-node="${esc(c.nodeId)}" data-name="${esc(c.name)}" data-port="${ports.panel}" data-gateway-port="${esc(ports.gateway || '')}">${icon('arrow-right', 10)} 切换管理</button>`
          : ''
      }
      <span class="unit-state ${stateClass}">${isRunning ? icon('swords', 12) + ' 出征中' : icon('tent', 12) + ' 休整中'}</span>
    </div>
    ${isRunning && (ports.panel || ports.gateway) ? `
      <div class="unit-links">
        ${ports.panel ? `<a href="${location.protocol}//${host}:${ports.panel}" target="_blank" rel="noopener" class="unit-link panel">${icon('monitor', 12)} 面板 :${ports.panel}</a>` : ''}
        ${ports.gateway ? `<span class="unit-link gateway" data-action="quick-chat" data-container-id="${esc(c.id)}" data-node-id="${esc(c.nodeId || '')}" data-name="${esc(c.name)}" title="发送测试消息">${icon('zap', 12)} 通讯 :${ports.gateway}</span>` : ''}
      </div>
    ` : ''}
    <div class="unit-card-footer">
      <span class="unit-image">${esc(c.image)}</span>
      <div class="unit-actions">
        ${isRunning
          ? `<button class="btn-icon" data-action="stop" data-ct="${esc(c.id)}" data-node="${esc(c.nodeId)}" title="休整">${icon('stop', 14)}</button>
             <button class="btn-icon" data-action="restart" data-ct="${esc(c.id)}" data-node="${esc(c.nodeId)}" title="整编">${icon('refresh-cw', 14)}</button>
             <button class="btn-icon" data-action="sync-config" data-ct="${esc(c.id)}" data-node="${esc(c.nodeId)}" data-name="${esc(c.name)}" data-role="${esc(role)}" title="同步配置（API Key + 性格 + 记忆）">${icon('upload', 14)}</button>`
          : `<button class="btn-icon" data-action="start" data-ct="${esc(c.id)}" data-node="${esc(c.nodeId)}" title="出征">${icon('play', 14)}</button>`
        }
        <button class="btn-icon" data-action="rebuild" data-ct="${esc(c.id)}" data-node="${esc(c.nodeId)}" data-name="${esc(c.name)}" title="重建（拉取最新镜像重新创建）">${icon('hammer', 14)}</button>
        <button class="btn-icon" data-action="inspect" data-ct="${esc(c.id)}" data-node="${esc(c.nodeId)}" title="军情">${icon('search', 14)}</button>
        <button class="btn-icon" data-action="logs" data-ct="${esc(c.id)}" data-node="${esc(c.nodeId)}" title="战报">${icon('clipboard', 14)}</button>
        ${isAdopted ? `<button class="btn-icon" data-action="unadopt" data-ct="${esc(c.id)}" title="脱编">${icon('x', 14)}</button>` : ''}
        <button class="btn-icon danger" data-action="remove" data-ct="${esc(c.id)}" data-node="${esc(c.nodeId)}" data-name="${esc(c.name)}" title="退役">${icon('trash', 14)}</button>
      </div>
    </div>
  </div>`
}

function renderWorkers(page, nodes) {
  const el = page.querySelector('#workers-grid')
  const allContainers = []
  for (const node of nodes) {
    if (!node.online || !node.containers) continue
    for (const c of node.containers) {
      allContainers.push({ ...c, nodeId: node.id, nodeName: node.name })
    }
  }
  _lastContainers = allContainers
  const managed = allContainers.filter(c => isManagedContainer(c))

  if (managed.length === 0) {
    el.innerHTML = `<div class="docker-empty-inline">
      <div style="font-size:40px;margin-bottom:12px">🦞</div>
      暂无兵力。前往基础设施，在军营中「征召龙虾」
    </div>`
    return
  }

  el.innerHTML = `<div class="unit-grid">${managed.map(c => _renderUnitCard(c, false)).join('')}</div>`

  // 有军团成员时显示批量操作栏 + 重置全选状态
  const batchEl = page.querySelector('#batch-actions')
  if (batchEl) batchEl.style.display = managed.length > 0 ? 'flex' : 'none'
  _updateBatchUI(page)
}

function renderOthers(page, nodes) {
  const el = page.querySelector('#docker-containers')
  const others = []
  for (const node of nodes) {
    if (!node.online || !node.containers) continue
    for (const c of node.containers) {
      if (!isManagedContainer(c)) others.push({ ...c, nodeId: node.id, nodeName: node.name })
    }
  }
  if (others.length === 0) { el.innerHTML = ''; return }
  el.innerHTML = `
    <div class="docker-section-header">
      <div class="docker-section-title">编外容器 <span class="docker-other-count">${others.length}</span></div>
    </div>
    <div class="unit-grid">${others.map(c => _renderUnitCard(c, true)).join('')}</div>
  `
}

// === 任务中心 ===

let _runningWorkers = [] // 缓存在线工人列表

function updateTaskTargets(page, nodes) {
  _runningWorkers = []
  for (const n of nodes) {
    if (!n.online || !n.containers) continue
    for (const c of n.containers) {
      if (isManagedContainer(c) && c.state === 'running') {
        const role = MILITARY.inferRole(c.name)
        const ports = _parseHostPorts(c.ports)
        _runningWorkers.push({ id: c.id, name: c.name, role, ports, nodeId: n.id })
      }
    }
  }
  // 更新任务中心可用状态
  const hub = page.querySelector('#task-hub')
  const sendBtn = page.querySelector('#task-send')
  if (hub) hub.style.display = _runningWorkers.length > 0 ? '' : 'none'
  if (sendBtn) sendBtn.disabled = _runningWorkers.length === 0

  // 更新指定模式的目标选择器
  _renderPickTargets(page)
}

function _renderPickTargets(page) {
  const el = page.querySelector('#task-pick')
  if (!el) return
  el.innerHTML = _runningWorkers.map(w => {
    const r = MILITARY.roles[w.role]
    return `<label class="pick-target" style="--pick-color:${r.color}">
      <input type="checkbox" class="pick-cb" data-id="${esc(w.id)}" checked>
      <span class="pick-dot" style="background:${r.color}"></span>
      <span>${esc(w.name.replace(/^openclaw-/, ''))}</span>
    </label>`
  }).join('')
}

function _smartRoute(command) {
  const cmd = command.toLowerCase()
  const keywords = {
    coder: ['代码', '编程', 'code', 'debug', '调试', '函数', 'bug', '重构', 'refactor'],
    translator: ['翻译', 'translate', '英译', '中译', '日译', '多语言'],
    writer: ['写', '文章', '文案', '作文', 'write', '创作', '文书', '邮件', 'email'],
    analyst: ['分析', '数据', 'data', 'analyze', '统计', '报表', '图表', '策略'],
  }
  for (const [role, words] of Object.entries(keywords)) {
    if (words.some(w => cmd.includes(w))) {
      const match = _runningWorkers.find(w => w.role === role)
      if (match) return [match]
    }
  }
  // 未匹配 → 第一个
  return _runningWorkers.length > 0 ? [_runningWorkers[0]] : []
}

function initTaskHub(page) {
  const input = page.querySelector('#task-input')
  const sendBtn = page.querySelector('#task-send')
  const modeBar = page.querySelector('#task-mode')
  const pickBar = page.querySelector('#task-pick')
  if (!input || !sendBtn) return

  let currentMode = 'broadcast'

  // 模式切换
  for (const btn of modeBar.querySelectorAll('.task-mode-btn')) {
    btn.onclick = () => {
      modeBar.querySelectorAll('.task-mode-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      currentMode = btn.dataset.mode
      pickBar.style.display = currentMode === 'pick' ? '' : 'none'
    }
  }

  // 自动调整高度
  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = Math.min(input.scrollHeight, 120) + 'px'
    sendBtn.disabled = !input.value.trim() || _runningWorkers.length === 0
  })

  // Enter 发送
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click() }
  })

  sendBtn.onclick = async () => {
    const command = input.value.trim()
    if (!command || _runningWorkers.length === 0) return

    // 确定目标
    let targets = []
    if (currentMode === 'broadcast') {
      targets = [..._runningWorkers]
    } else if (currentMode === 'smart') {
      targets = _smartRoute(command)
    } else if (currentMode === 'pick') {
      const checked = page.querySelectorAll('#task-pick .pick-cb:checked')
      const ids = new Set([...checked].map(cb => cb.dataset.id))
      targets = _runningWorkers.filter(w => ids.has(w.id))
    }

    if (targets.length === 0) { toast('没有可用的目标', 'error'); return }

    // 异步派发 — 立即返回，不阻塞 UI
    sendBtn.disabled = true
    try {
      const dispatchTargets = buildDockerDispatchTargets(targets)
      await api.dockerDispatchBroadcast(null, dispatchTargets, command, DOCKER_TASK_TIMEOUT_MS)
      toast(`任务已派发给 ${targets.length} 名龙虾兵`, 'success')
    } catch (e) {
      toast(`派发失败: ${e.message}`, 'error')
      sendBtn.disabled = false
      return
    }

    // 清空输入，启动工作区轮询
    input.value = ''
    input.style.height = 'auto'
    sendBtn.disabled = !input.value.trim() || _runningWorkers.length === 0
    _startWorkspacePolling(page)
    _refreshWorkspace(page)
  }
}

// === 异步工作区 ===

function _startWorkspacePolling(page) {
  if (_workspaceTimer) return
  _workspaceTimer = setInterval(() => _refreshWorkspace(page), 3000)
}

function _stopWorkspacePolling() {
  if (_workspaceTimer) { clearInterval(_workspaceTimer); _workspaceTimer = null }
}

async function _refreshWorkspace(page) {
  const wsEl = page.querySelector('#task-workspace')
  if (!wsEl) return

  try {
    const tasks = await api.dockerTaskList()
    if (!tasks || tasks.length === 0) {
      wsEl.style.display = 'none'
      _stopWorkspacePolling()
      return
    }

    wsEl.style.display = ''
    _renderWorkspaceWorkers(page, tasks)
    _renderWorkspaceHistory(page, tasks)

    // 没有正在运行的任务时停止轮询
    const hasRunning = tasks.some(t => t.status === 'running')
    if (!hasRunning) _stopWorkspacePolling()
  } catch (e) {
    console.warn('[workspace] 刷新失败:', e.message)
  }
}

function _renderWorkspaceWorkers(page, tasks) {
  const el = page.querySelector('#workspace-workers')
  if (!el) return

  // 用 containerId 去重，取每个容器最新的任务
  const latestByContainer = new Map()
  for (const t of tasks) {
    if (!latestByContainer.has(t.containerId) || t.startedAt > latestByContainer.get(t.containerId).startedAt) {
      latestByContainer.set(t.containerId, t)
    }
  }

  // 只展示有任务的工人
  const workers = [...latestByContainer.values()]
  if (workers.length === 0) { el.innerHTML = ''; return }

  el.innerHTML = `<div class="ws-worker-grid">${workers.map(t => {
    const role = MILITARY.inferRole(t.containerName)
    const r = MILITARY.roles[role] || MILITARY.roles.general
    const shortName = (t.containerName || '').replace(/^openclaw-/, '')
    const isRunning = t.status === 'running'
    const isError = t.status === 'error'
    const elapsed = t.elapsed ? (t.elapsed / 1000).toFixed(0) : '0'
    const msgPreview = (t.message || '').slice(0, 40) + ((t.message || '').length > 40 ? '...' : '')

    return `<div class="ws-worker ${isRunning ? 'working' : 'idle'}" data-task-id="${esc(t.id)}" style="--worker-color:${r.color}">
      <div class="ws-worker-top">
        ${pixelRole(role, 28)}
        <div class="ws-worker-info">
          <div class="ws-worker-name">${esc(shortName)}</div>
          <div class="ws-worker-role">${r.title} — ${r.desc}</div>
        </div>
        <div class="ws-worker-badge ${isRunning ? 'running' : isError ? 'error' : 'done'}">
          ${isRunning ? `${icon('zap', 10)} 工作中` : isError ? `${icon('x-circle', 10)} 失败` : `${icon('check-circle', 10)} 完成`}
        </div>
      </div>
      <div class="ws-worker-task">
        <div class="ws-worker-msg">${icon('message-square', 10)} ${esc(msgPreview)}</div>
        <div class="ws-worker-time">${isRunning ? `⏱ ${elapsed}s...` : `${elapsed}s`}</div>
      </div>
    </div>`
  }).join('')}</div>`
}

function _renderWorkspaceHistory(page, tasks) {
  const el = page.querySelector('#workspace-history')
  if (!el) return

  // 只显示已完成/失败的任务
  const finished = tasks.filter(t => t.status !== 'running')
  if (finished.length === 0) { el.innerHTML = ''; return }

  el.innerHTML = `
    <div class="ws-history-title">${icon('clock', 12)} 任务记录</div>
    <div class="ws-history-list">
      ${finished.map(t => {
        const shortName = (t.containerName || '').replace(/^openclaw-/, '')
        const elapsed = t.elapsed ? (t.elapsed / 1000).toFixed(1) : '0'
        const msgPreview = (t.message || '').slice(0, 50) + ((t.message || '').length > 50 ? '...' : '')
        const isError = t.status === 'error'
        const time = new Date(t.startedAt)
        const timeStr = `${time.getHours().toString().padStart(2,'0')}:${time.getMinutes().toString().padStart(2,'0')}`
        return `<div class="ws-history-item ${isError ? 'error' : 'done'}" data-task-id="${esc(t.id)}">
          <span class="ws-history-icon">${isError ? icon('x-circle', 12) : icon('check-circle', 12)}</span>
          <span class="ws-history-name">${esc(shortName)}</span>
          <span class="ws-history-msg">${esc(msgPreview)}</span>
          <span class="ws-history-meta">${elapsed}s · ${timeStr}</span>
          ${t.hasResult ? `<button class="btn btn-xs btn-secondary ws-history-view" data-task-id="${esc(t.id)}">查看结果</button>` : ''}
        </div>`
      }).join('')}
    </div>
  `
}

async function _showTaskDetail(page, taskId) {
  try {
    const task = await api.dockerTaskStatus(taskId)
    if (!task) { toast('任务不存在', 'error'); return }

    const shortName = (task.containerName || '').replace(/^openclaw-/, '')
    const elapsed = task.elapsed ? (task.elapsed / 1000).toFixed(1) : '0'
    const isError = task.status === 'error'

    // 提取结果文本
    let resultText = ''
    if (task.result?.result) {
      resultText = task.result.result
    } else if (task.error) {
      resultText = `错误: ${task.error}`
    } else if (task.events?.length) {
      const finals = task.events.filter(e => e.type === 'final' || e.type === 'result')
      resultText = finals.map(e => e.text || e.message || JSON.stringify(e)).join('\n')
    }
    if (!resultText) resultText = '（无回复）'

    // 提取工具调用日志
    const toolCalls = (task.events || []).filter(e => e.type === 'tool_call' || e.type === 'tool_result')
    const toolHtml = toolCalls.length > 0 ? `
      <div class="task-detail-section">
        <div class="task-detail-label">${icon('gear', 12)} 工具调用 (${toolCalls.length})</div>
        <div class="task-detail-tools">
          ${toolCalls.map(tc => `<div class="task-detail-tool">
            <code>${esc(tc.name || tc.tool || tc.type)}</code>
            ${tc.input ? `<pre>${esc(typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input, null, 2)).slice(0, 500)}</pre>` : ''}
            ${tc.output ? `<pre class="tool-output">${esc(typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output, null, 2)).slice(0, 500)}</pre>` : ''}
          </div>`).join('')}
        </div>
      </div>
    ` : ''

    // 展示详情弹窗
    const { showConfirm: _ } = await import('../components/modal.js')
    const overlay = document.createElement('div')
    overlay.className = 'task-detail-overlay'
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove() }
    overlay.innerHTML = `
      <div class="task-detail-modal">
        <div class="task-detail-header">
          <span>${isError ? icon('x-circle', 16) : icon('check-circle', 16)} ${esc(shortName)} — 任务详情</span>
          <button class="btn btn-sm" onclick="this.closest('.task-detail-overlay').remove()">${icon('x', 14)}</button>
        </div>
        <div class="task-detail-body">
          <div class="task-detail-section">
            <div class="task-detail-label">${icon('message-square', 12)} 指令</div>
            <div class="task-detail-content">${esc(task.message)}</div>
          </div>
          <div class="task-detail-section">
            <div class="task-detail-label">${isError ? icon('x-circle', 12) + ' 错误' : icon('check-circle', 12) + ' 结果'}</div>
            <pre class="task-detail-result ${isError ? 'error' : ''}">${esc(resultText)}</pre>
          </div>
          ${toolHtml}
          <div class="task-detail-meta">
            耗时 ${elapsed}s · ${new Date(task.startedAt).toLocaleTimeString()}
          </div>
        </div>
      </div>
    `
    document.body.appendChild(overlay)
  } catch (e) {
    toast(`加载任务详情失败: ${e.message}`, 'error')
  }
}

function _updateBatchUI(page) {
  const checks = page.querySelectorAll('.ct-select:checked')
  const countEl = page.querySelector('#batch-count')
  if (countEl) countEl.textContent = `${checks.length} 名已选`
  const selectAll = page.querySelector('#ct-select-all')
  const allChecks = page.querySelectorAll('.ct-select')
  if (selectAll && allChecks.length) selectAll.checked = checks.length === allChecks.length
  // 批量按钮启用/禁用
  for (const btn of page.querySelectorAll('.batch-btn')) {
    btn.disabled = checks.length === 0
  }
}

function bindEvents(page) {
  // 全选 / 单选 复选框
  page.addEventListener('change', (e) => {
    if (e.target.id === 'ct-select-all') {
      const checked = e.target.checked
      page.querySelectorAll('.ct-select').forEach(cb => cb.checked = checked)
    }
    if (e.target.classList.contains('ct-select') || e.target.id === 'ct-select-all') {
      _updateBatchUI(page)
    }
  })

  page.addEventListener('click', async (e) => {
    // 工作区：点击工人卡片或历史条目查看详情
    const wsWorker = e.target.closest('.ws-worker[data-task-id]')
    const wsView = e.target.closest('.ws-history-view[data-task-id]')
    const wsItem = e.target.closest('.ws-history-item[data-task-id]')
    if (wsView) { _showTaskDetail(page, wsView.dataset.taskId); return }
    if (wsWorker && !wsWorker.querySelector('.ws-worker-badge.running')) { _showTaskDetail(page, wsWorker.dataset.taskId); return }
    if (wsItem && !wsView) { _showTaskDetail(page, wsItem.dataset.taskId); return }

    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action

    // 工作区清空
    if (action === 'workspace-clear') {
      const wsEl = page.querySelector('#task-workspace')
      if (wsEl) wsEl.style.display = 'none'
      _stopWorkspacePolling()
      return
    }

    // 切换管理实例
    if (action === 'switch-instance') {
      const ct = btn.dataset.ct
      const name = btn.dataset.name
      const port = btn.dataset.port
      const gatewayPort = btn.dataset.gatewayPort
      const nodeId = btn.dataset.node || null
      if (!ct || !port) return
      const switchCtx = buildDockerInstanceSwitchContext({
        containerId: ct,
        name,
        port,
        gatewayPort,
        nodeId,
      })
      const originalHtml = btn.innerHTML
      btn.disabled = true
      btn.textContent = '切换中...'
      try {
        await switchInstance(switchCtx.instanceId)
        toast(`已切换管理 → ${name}（模型配置、Agent 等将管理该士兵）`, 'success')
        const sidebar = document.getElementById('sidebar')
        if (sidebar) renderSidebar(sidebar)
        if (switchCtx.reloadRoute) {
          reloadCurrentRoute()
          return
        }
        await loadClusterOverview(page)
      } catch (e) {
        try {
          const added = await api.instanceAdd(switchCtx.registration)
          await switchInstance(added.id)
          toast(`已注册并切换管理 → ${name}`, 'success')
          const sidebar = document.getElementById('sidebar')
          if (sidebar) renderSidebar(sidebar)
          if (switchCtx.reloadRoute) {
            reloadCurrentRoute()
            return
          }
          await loadClusterOverview(page)
        } catch (e2) {
          btn.disabled = false
          btn.innerHTML = originalHtml
          toast(`切换失败: ${e2.message}`, 'error')
        }
      }
      return
    }

    // 批量操作
    if (action.startsWith('batch-')) {
      const op = action.replace('batch-', '')
      const checks = page.querySelectorAll('.ct-select:checked')
      if (checks.length === 0) { toast('请先勾选士兵', 'error'); return }

      const OP_NAMES = { start: '出征', stop: '休整', restart: '整编', sync: '同步配置', rebuild: '重建', remove: '退役' }
      const opName = OP_NAMES[op] || op

      const confirmMsgs = {
        start: '将启动所有已勾选的士兵。',
        stop: '将停止所有已勾选的士兵。',
        restart: '将重启所有已勾选的士兵。',
        sync: '将向所有已勾选的士兵同步 API Key、兵种配置和 Agent。',
        rebuild: '将拉取最新镜像并重建所有已勾选的士兵（数据卷保留）。\n⚠ 重建过程中士兵将暂时离线。',
        remove: '⚠ 此操作不可撤销！将永久退役所有已勾选的士兵。',
      }

      const ok = await showConfirm(`军令：${opName} ${checks.length} 名士兵？`, confirmMsgs[op] || '将对所有已勾选的士兵执行命令。')
      if (!ok) return

      toast(`正在执行军令: ${opName}...`, 'info')

      // 禁用所有批量按钮
      page.querySelectorAll('.batch-btn').forEach(b => b.disabled = true)

      let success = 0, fail = 0
      const total = checks.length
      const errors = []

      for (const cb of checks) {
        const nId = cb.dataset.node, cId = cb.dataset.ct
        const cName = cb.closest('.unit-card')?.querySelector('.unit-name')?.textContent || cId
        try {
          if (op === 'start') await api.dockerStartContainer(nId, cId)
          else if (op === 'stop') await api.dockerStopContainer(nId, cId)
          else if (op === 'restart') await api.dockerRestartContainer(nId, cId)
          else if (op === 'sync') {
            const role = MILITARY.inferRole(cName)
            await api.dockerInitWorker(nId, cId, role)
          }
          else if (op === 'rebuild') await api.dockerRebuildContainer(nId, cId, true)
          else if (op === 'remove') await api.dockerRemoveContainer(nId, cId, true)
          success++
          toast(`${opName}进度: ${success + fail}/${total}`, 'info')
        } catch (e) {
          fail++
          errors.push(`${cName}: ${e.message}`)
          console.error(`[batch-${op}] ${cName} 失败:`, e.message)
        }
      }

      const resultType = fail === 0 ? 'success' : fail === total ? 'error' : 'info'
      let msg = `军令执行完毕: ${success} 名${opName}${fail ? `，${fail} 名失败` : ''}`
      if (errors.length > 0) msg += `\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? `\n...还有 ${errors.length - 3} 个错误` : ''}`
      toast(msg, resultType)
      await loadClusterOverview(page)
      return
    }

    if (action === 'refresh') {
      toast('侦察中...')
      await loadClusterOverview(page)
      return
    }

    if (action === 'add-node') {
      showAddNodeDialog(page)
      return
    }

    if (action === 'remove-node') {
      const nodeId = btn.dataset.nodeId
      const ok = await showConfirm('确定撤销此军营？', '撤销后该军营的士兵将不再接受指挥。')
      if (!ok) return
      try {
        await api.dockerRemoveNode(nodeId)
        toast('军营已撤销')
        await loadClusterOverview(page)
      } catch (e) { toast(e.message, 'error') }
      return
    }

    if (action === 'deploy') {
      showDeployDialog(page, btn.dataset.nodeId)
      return
    }

    if (action === 'adopt') {
      const ids = getAdoptedIds()
      ids.add(btn.dataset.ct)
      saveAdoptedIds(ids)
      toast(`${btn.dataset.name || btn.dataset.ct} 已编入军团`)
      await loadClusterOverview(page)
      return
    }

    if (action === 'unadopt') {
      const ids = getAdoptedIds()
      ids.delete(btn.dataset.ct)
      saveAdoptedIds(ids)
      toast('已脱编')
      await loadClusterOverview(page)
      return
    }

    const containerId = btn.dataset.ct
    const nodeId = btn.dataset.node

    if (action === 'start') {
      try {
        btn.disabled = true
        await api.dockerStartContainer(nodeId, containerId)
        toast('士兵已出征')
        await loadClusterOverview(page)
      } catch (e) { toast(e.message, 'error') }
      return
    }

    if (action === 'stop') {
      try {
        btn.disabled = true
        await api.dockerStopContainer(nodeId, containerId)
        toast('士兵已休整')
        await loadClusterOverview(page)
      } catch (e) { toast(e.message, 'error') }
      return
    }

    if (action === 'restart') {
      try {
        btn.disabled = true
        await api.dockerRestartContainer(nodeId, containerId)
        toast('士兵已整编')
        await loadClusterOverview(page)
      } catch (e) { toast(e.message, 'error') }
      return
    }

    if (action === 'remove') {
      const name = btn.dataset.name || containerId
      const ok = await showConfirm(`确定让 ${name} 退役？`, '军备库数据保留，但士兵本体将被遗散。')
      if (!ok) return
      try {
        await api.dockerRemoveContainer(nodeId, containerId, true)
        toast('士兵已退役')
        await loadClusterOverview(page)
      } catch (e) { toast(e.message, 'error') }
      return
    }

    if (action === 'rebuild') {
      const name = btn.dataset.name || containerId
      const ok = await showConfirm(`重建 ${name}？`, '将拉取最新镜像并重新创建容器，数据卷保留。\n重建期间士兵将暂时离线。')
      if (!ok) return
      btn.disabled = true
      toast(`正在重建 ${name}...`, 'info')
      try {
        const result = await api.dockerRebuildContainer(nodeId, containerId, true)
        toast(`${result.name || name} 已重建完成`, 'success')
        await loadClusterOverview(page)
      } catch (e) {
        toast(`${name} 重建失败: ${e.message}`, 'error')
        btn.disabled = false
      }
      return
    }

    if (action === 'sync-config') {
      const cid = btn.dataset.ct
      const nid = btn.dataset.node || null
      const name = btn.dataset.name || cid
      const role = btn.dataset.role || 'general'
      toast(`正在同步配置到 ${name}...`, 'info')
      try {
        const result = await api.dockerInitWorker(nid, cid, role)
        const count = result?.files?.length || 0
        // docker_init_worker 内部已重启 Gateway，不需要重启容器（重启会触发 entrypoint 覆盖配置）
        toast(`${name}: 已同步 ${count} 个文件，Gateway 已重启`, 'success')
        setTimeout(() => loadClusterOverview(page), 3000)
      } catch (e) {
        toast(`${name} 同步失败: ${e.message}`, 'error')
      }
      return
    }

    if (action === 'quick-chat') {
      const cid = btn.dataset.containerId
      const nid = btn.dataset.nodeId || null
      const name = btn.dataset.name || cid
      toast(`正在连接 ${name} 的 Gateway...`, 'info')
      try {
        const resp = await api.dockerAgent(nid, cid, { cmd: 'task.run', message: '你好，报告你的兵种和状态' })
        toast(`${name} 回复: ${(resp?.result || '（无回复）').slice(0, 100)}`, 'success')
      } catch (e) {
        toast(`${name} 通讯失败: ${e.message}`, 'error')
      }
      return
    }

    if (action === 'inspect') {
      showInspectDialog(page, nodeId, containerId)
      return
    }

    if (action === 'logs') {
      showLogsDialog(page, nodeId, containerId)
      return
    }
  })
}

function showAddNodeDialog(page) {
  const isWin = navigator.platform?.toLowerCase().includes('win')
  const presets = [
    { label: '本机 (TCP)', endpoint: 'tcp://127.0.0.1:2375', desc: '本机 Docker TCP 端口' },
    { label: '本机 (Socket)', endpoint: isWin ? '//./pipe/docker_engine' : 'unix:///var/run/docker.sock', desc: isWin ? 'Windows Named Pipe' : 'Unix Socket' },
  ]

  const overlay = document.createElement('div')
  overlay.className = 'docker-dialog-overlay'
  overlay.innerHTML = `
    <div class="docker-dialog">
      <div class="docker-dialog-title">${icon('castle', 16)} 建立新军营</div>
      <div class="form-group">
        <label class="form-label">军营名称</label>
        <input class="form-input" id="dn-name" placeholder="如：生产服务器" />
      </div>
      <div class="form-group">
        <label class="form-label">Docker 端点</label>
        <div class="dn-presets">
          ${presets.map((p, i) => `<button class="dn-preset-btn" data-idx="${i}" title="${esc(p.desc)}">${esc(p.label)}</button>`).join('')}
          <button class="dn-preset-btn" data-idx="custom">自定义</button>
        </div>
        <div id="dn-endpoint-row" style="display:flex;gap:8px;align-items:center;margin-top:8px">
          <input class="form-input" id="dn-endpoint" placeholder="tcp://192.168.1.100:2375" style="flex:1" />
          <button class="btn btn-sm" id="dn-test" type="button" style="white-space:nowrap">测试连接</button>
        </div>
        <div id="dn-test-result" style="font-size:12px;margin-top:6px;min-height:18px"></div>
      </div>
      <div class="docker-dialog-hint">
        <strong>远程 Docker：</strong>需在目标机器开启 TCP 端口<br>
        <code>dockerd -H tcp://0.0.0.0:2375</code>
      </div>
      <div class="docker-dialog-actions">
        <button class="btn" data-dismiss>取消</button>
        <button class="btn btn-primary" id="dn-submit">添加</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  overlay.querySelector('[data-dismiss]').onclick = () => overlay.remove()
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })

  const epInput = overlay.querySelector('#dn-endpoint')
  const resultEl = overlay.querySelector('#dn-test-result')

  // 预设按钮点击
  for (const btn of overlay.querySelectorAll('.dn-preset-btn')) {
    btn.onclick = () => {
      overlay.querySelectorAll('.dn-preset-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      const idx = btn.dataset.idx
      if (idx === 'custom') {
        epInput.value = ''
        epInput.focus()
      } else {
        epInput.value = presets[parseInt(idx)].endpoint
      }
      resultEl.textContent = ''
    }
  }

  // 测试连接
  overlay.querySelector('#dn-test').onclick = async () => {
    const ep = epInput.value.trim()
    if (!ep) { resultEl.innerHTML = '<span style="color:var(--error,#ef4444)">请先输入端点</span>'; return }
    resultEl.innerHTML = '<span style="color:var(--text-tertiary)">连接中...</span>'
    try {
      const info = await api.dockerTestEndpoint(ep)
      resultEl.innerHTML = `<span style="color:var(--success,#22c55e)">${icon('check-circle', 14)} 连接成功 — Docker ${esc(info.ServerVersion || '?')}，${info.Containers || 0} 个容器</span>`
    } catch (e) {
      resultEl.innerHTML = `<span style="color:var(--error,#ef4444)">${icon('x-circle', 14)} 连接失败：${esc(e.message)}</span>`
    }
  }

  overlay.querySelector('#dn-submit').onclick = async () => {
    const name = overlay.querySelector('#dn-name').value.trim()
    const endpoint = epInput.value.trim()
    if (!name || !endpoint) { toast('请填写完整', 'error'); return }
    const btn = overlay.querySelector('#dn-submit')
    btn.disabled = true
    btn.textContent = '连接中...'
    try {
      await api.dockerAddNode(name, endpoint)
      toast('节点添加成功')
      overlay.remove()
      await loadClusterOverview(page)
    } catch (e) {
      toast(e.message, 'error')
      btn.disabled = false
      btn.textContent = '添加'
    }
  }
}

async function showDeployDialog(page, nodeId) {
  // 自动检测已用端口，分配下一组可用端口
  let usedPorts = new Set()
  try {
    const containers = await api.dockerListContainers(nodeId, true)
    for (const c of containers) {
      if (c.ports) {
        for (const p of c.ports.split(', ')) {
          const m = p.match(/^(\d+)/)
          if (m) usedPorts.add(parseInt(m[1]))
        }
      }
    }
  } catch {}
  let autoPanel = 1421
  while (usedPorts.has(autoPanel)) autoPanel++
  let autoGw = 18790
  while (usedPorts.has(autoGw)) autoGw++

  const defaultName = `openclaw-${Date.now().toString(36).slice(-4)}`

  const MIRRORS = {
    ghcr: { label: 'GitHub (ghcr.io)', image: 'ghcr.io/qingchencloud/openclaw' },
    tencent: { label: '国内源 (腾讯云)', image: 'ccr.ccs.tencentyun.com/qingchencloud/openclaw' },
    dockerhub: { label: 'Docker Hub', image: '1186258278/openclaw' },
  }
  const defaultMirror = 'ghcr'

  const overlay = document.createElement('div')
  overlay.className = 'docker-dialog-overlay'
  overlay.innerHTML = `
    <div class="docker-dialog">
      <div class="docker-dialog-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>${icon('scroll', 16)} 征召令</span>
        <div class="deploy-mode-toggle">
          <button class="deploy-mode-btn active" data-mode="basic">基础</button>
          <button class="deploy-mode-btn" data-mode="advanced">高级</button>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">士兵代号</label>
        <input class="form-input" id="dd-name" placeholder="给新兵起个代号" value="${defaultName}" />
      </div>

      <div id="deploy-basic-info">
        <div class="form-group">
          <label class="form-label">${icon('swords', 14)} 兵种选择</label>
          <div class="role-selector" id="dd-role-selector">
            ${Object.entries(MILITARY.roles).map(([key, r]) => `
              <div class="role-card${key === 'general' ? ' selected' : ''}" data-role="${key}" style="--role-color:${r.color}">
                <div class="role-card-badge">${pixelRole(key, 40)}</div>
                <div class="role-card-title">${r.title}</div>
                <div class="role-card-desc">${r.desc}</div>
              </div>
            `).join('')}
          </div>
          <div class="role-selected-info" id="dd-role-info" style="--role-color:${MILITARY.roles.general.color}">
            <div class="role-selected-badge">${pixelRole('general', 32)}</div>
            <div class="role-selected-text"><strong>步兵</strong> — 通用作战，什么都能做。适合不确定用途的新兵。</div>
          </div>
          <input type="hidden" id="dd-role" value="general" />
        </div>
        <div class="form-group">
          <label class="form-label">补给源</label>
          <select class="form-input" id="dd-mirror">
            <option value="ghcr">GitHub (ghcr.io) — 默认</option>
            <option value="tencent">国内源 (腾讯云) — 国内服务器推荐</option>
            <option value="dockerhub">Docker Hub</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">武器配置 (AI 模型) <span style="color:var(--text-tertiary)">(可选，也可入伍后配置)</span></label>
          <select class="form-input" id="dd-provider" style="margin-bottom:6px">
            <option value="">跳过 — 入伍后手动配置</option>
            <option value="free">◆ 公益装备 — 免费使用（推荐新兵）</option>
            <option value="openai">OpenAI — GPT-4o / GPT-5</option>
            <option value="anthropic">Anthropic — Claude</option>
            <option value="custom">自定义 OpenAI 兼容接口</option>
          </select>
          <div id="dd-provider-fields" style="display:none">
            <input class="form-input" id="dd-api-key" placeholder="API Key" style="margin-bottom:6px;font-family:var(--font-mono);font-size:12px" />
            <input class="form-input" id="dd-base-url" placeholder="Base URL (可选)" style="font-family:var(--font-mono);font-size:12px" />
          </div>
        </div>
        <div class="deploy-auto-summary">
          <div class="deploy-auto-title">入伍配置</div>
          <div class="deploy-auto-item"><span>装备包</span><span id="dd-mirror-label">一体版 (latest)</span></div>
          <div class="deploy-auto-item"><span>指挥端口</span><span>${autoPanel}</span></div>
          <div class="deploy-auto-item"><span>通讯端口</span><span>${autoGw}</span></div>
          <div class="deploy-auto-item"><span>军备库</span><span>自动分配</span></div>
          <div class="deploy-auto-item"><span>抗打能力</span><span>战损自修 (unless-stopped)</span></div>
        </div>
      </div>

      <div id="deploy-advanced-fields" style="display:none">
        <div class="form-group">
          <label class="form-label">镜像</label>
          <select class="form-input" id="dd-image">
            <option value="ghcr.io/qingchencloud/openclaw:latest">一体版 - GitHub (latest)</option>
            <option value="ghcr.io/qingchencloud/openclaw:latest-gateway">纯 Gateway - GitHub</option>
            <option value="ccr.ccs.tencentyun.com/qingchencloud/openclaw:latest">一体版 - 国内源 (腾讯云)</option>
            <option value="ccr.ccs.tencentyun.com/qingchencloud/openclaw:latest-gateway">纯 Gateway - 国内源 (腾讯云)</option>
            <option value="1186258278/openclaw:latest">一体版 - Docker Hub</option>
            <option value="1186258278/openclaw:latest-gateway">纯 Gateway - Docker Hub</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-sm)">
          <div class="form-group">
            <label class="form-label">面板端口</label>
            <input class="form-input" id="dd-panel-port" type="number" value="${autoPanel}" />
          </div>
          <div class="form-group">
            <label class="form-label">Gateway 端口</label>
            <input class="form-input" id="dd-gw-port" type="number" value="${autoGw}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">环境变量 <span style="color:var(--text-tertiary)">(可选)</span></label>
          <textarea class="form-input" id="dd-env-key" rows="2" placeholder="OPENAI_API_KEY=sk-xxx" style="resize:vertical;font-family:var(--font-mono);font-size:12px"></textarea>
          <div class="form-hint">格式：KEY=VALUE，每行一个</div>
        </div>
      </div>

      <div class="docker-dialog-actions">
        <button class="btn" data-dismiss>取消</button>
        <button class="btn btn-primary" id="dd-submit">${icon('swords', 14)} 征召入伍</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  overlay.querySelector('[data-dismiss]').onclick = () => overlay.remove()
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })

  // 镜像源切换 → 更新基础模式标签
  const mirrorSelect = overlay.querySelector('#dd-mirror')
  const mirrorLabel = overlay.querySelector('#dd-mirror-label')
  if (mirrorSelect && mirrorLabel) {
    mirrorSelect.onchange = () => {
      const m = MIRRORS[mirrorSelect.value]
      mirrorLabel.textContent = m ? `一体版 · ${m.label}` : '一体版 (latest)'
    }
  }

  // 模型提供商切换 → 显示/隐藏 API Key 输入
  const providerSelect = overlay.querySelector('#dd-provider')
  const providerFields = overlay.querySelector('#dd-provider-fields')
  if (providerSelect && providerFields) {
    providerSelect.onchange = () => {
      const v = providerSelect.value
      providerFields.style.display = (v === 'openai' || v === 'anthropic' || v === 'custom') ? '' : 'none'
      const keyInput = overlay.querySelector('#dd-api-key')
      const urlInput = overlay.querySelector('#dd-base-url')
      if (v === 'openai') { urlInput.value = 'https://api.openai.com/v1'; urlInput.placeholder = 'https://api.openai.com/v1' }
      else if (v === 'anthropic') { urlInput.value = 'https://api.anthropic.com'; urlInput.placeholder = 'https://api.anthropic.com' }
      else if (v === 'custom') { urlInput.value = ''; urlInput.placeholder = 'https://your-api.com/v1' }
      if (keyInput) keyInput.value = ''
    }
  }

  // 兵种卡片选择器
  const ROLE_DESCS = {
    general:    '通用作战，什么都能做。适合不确定用途的新兵。',
    coder:      '编程突击专精，擅长写代码、调试、Code Review。',
    translator: '多语言翻译作战，精通各国语言互译。',
    writer:     '文案、文章、创意写作，笔下生花。',
    analyst:    '数据分析与战略规划，运筹帷幄。',
    custom:     '自定义特殊任务，按需配置。',
  }
  const roleHidden = overlay.querySelector('#dd-role')
  const roleInfo = overlay.querySelector('#dd-role-info')
  const nameInput = overlay.querySelector('#dd-name')
  for (const card of overlay.querySelectorAll('.role-card')) {
    card.onclick = () => {
      overlay.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'))
      card.classList.add('selected')
      const r = card.dataset.role
      const info = MILITARY.roles[r]
      if (roleHidden) roleHidden.value = r
      if (roleInfo) {
        roleInfo.style.setProperty('--role-color', info.color)
        roleInfo.innerHTML = `
          <div class="role-selected-badge">${pixelRole(r, 32)}</div>
          <div class="role-selected-text"><strong>${info.title}</strong> — ${ROLE_DESCS[r] || info.desc}</div>
        `
      }
      if (nameInput && r !== 'custom') {
        nameInput.value = `openclaw-${r}-${Date.now().toString(36).slice(-4)}`
      }
    }
  }

  // 基础/高级模式切换
  let isAdvanced = false
  for (const btn of overlay.querySelectorAll('.deploy-mode-btn')) {
    btn.onclick = () => {
      isAdvanced = btn.dataset.mode === 'advanced'
      overlay.querySelectorAll('.deploy-mode-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      overlay.querySelector('#deploy-basic-info').style.display = isAdvanced ? 'none' : ''
      overlay.querySelector('#deploy-advanced-fields').style.display = isAdvanced ? '' : 'none'
      overlay.querySelector('#dd-submit').innerHTML = isAdvanced ? icon('swords', 14) + ' 部署' : icon('swords', 14) + ' 征召入伍'
    }
  }

  overlay.querySelector('#dd-submit').onclick = async () => {
    const name = overlay.querySelector('#dd-name').value.trim()
    if (!name) { toast('请输入士兵代号', 'error'); return }
    let image, tag, panelPort, gatewayPort, envVars = {}
    if (isAdvanced) {
      const imgFull = overlay.querySelector('#dd-image').value
      const parts = imgFull.split(':')
      tag = parts.pop()
      image = parts.join(':')
      panelPort = parseInt(overlay.querySelector('#dd-panel-port').value) || autoPanel
      gatewayPort = parseInt(overlay.querySelector('#dd-gw-port').value) || autoGw
      const envText = overlay.querySelector('#dd-env-key').value.trim()
      if (envText) {
        for (const line of envText.split('\n')) {
          const idx = line.indexOf('=')
          if (idx > 0) envVars[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
        }
      }
    } else {
      const mirrorKey = overlay.querySelector('#dd-mirror').value || defaultMirror
      const mirrorImg = MIRRORS[mirrorKey].image + ':latest'
      const parts = mirrorImg.split(':')
      tag = parts.pop()
      image = parts.join(':')
      panelPort = autoPanel
      gatewayPort = autoGw
      // 角色标签
      const role = overlay.querySelector('#dd-role')?.value || 'general'
      if (role !== 'custom') envVars['OPENCLAW_ROLE'] = role
      // AI 模型配置
      const provider = overlay.querySelector('#dd-provider')?.value || ''
      if (provider === 'free') {
        envVars['OPENCLAW_FREE_AI'] = 'true'
      } else if (provider === 'openai' || provider === 'anthropic' || provider === 'custom') {
        const apiKey = overlay.querySelector('#dd-api-key')?.value?.trim()
        const baseUrl = overlay.querySelector('#dd-base-url')?.value?.trim()
        if (apiKey) {
          if (provider === 'anthropic') {
            envVars['ANTHROPIC_API_KEY'] = apiKey
            if (baseUrl) envVars['ANTHROPIC_BASE_URL'] = baseUrl
          } else {
            envVars['OPENAI_API_KEY'] = apiKey
            if (baseUrl) envVars['OPENAI_BASE_URL'] = baseUrl
          }
        }
      }
    }
    const dialog = overlay.querySelector('.docker-dialog')
    const requestId = `pull-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

    // 切换到部署进度视图
    dialog.innerHTML = `
      <div class="deploy-progress">
        <div class="deploy-progress-header">
          <div class="deploy-progress-icon">🦞</div>
          <div class="deploy-progress-title">正在征召龙虾...</div>
          <div class="deploy-progress-subtitle">${esc(name)}</div>
        </div>
        <div class="deploy-progress-steps">
          <div class="deploy-step active" id="step-pull">
            <div class="deploy-step-icon">${icon('package', 18)}</div>
            <div class="deploy-step-info">
              <div class="deploy-step-label">拉取镜像</div>
              <div class="deploy-step-detail" id="pull-detail">连接中...</div>
            </div>
          </div>
          <div class="deploy-step" id="step-create">
            <div class="deploy-step-icon">${icon('gear', 18)}</div>
            <div class="deploy-step-info">
              <div class="deploy-step-label">创建容器</div>
              <div class="deploy-step-detail" id="create-detail">等待中</div>
            </div>
          </div>
          <div class="deploy-step" id="step-start">
            <div class="deploy-step-icon">${icon('rocket', 18)}</div>
            <div class="deploy-step-info">
              <div class="deploy-step-label">启动服务</div>
              <div class="deploy-step-detail" id="start-detail">等待中</div>
            </div>
          </div>
        </div>
        <div class="deploy-progress-bar-wrap">
          <div class="deploy-progress-bar" id="pull-bar" style="width:0%"></div>
        </div>
        <div class="deploy-progress-log" id="pull-log"></div>
      </div>
    `

    const pullDetail = dialog.querySelector('#pull-detail')
    const pullBar = dialog.querySelector('#pull-bar')
    const pullLog = dialog.querySelector('#pull-log')
    const stepPull = dialog.querySelector('#step-pull')
    const stepCreate = dialog.querySelector('#step-create')
    const stepStart = dialog.querySelector('#step-start')
    const createDetail = dialog.querySelector('#create-detail')
    const startDetail = dialog.querySelector('#start-detail')

    // 轮询拉取进度
    let pollTimer = setInterval(async () => {
      try {
        const s = await api.dockerPullStatus(requestId)
        if (!s || s.status === 'unknown') return
        pullDetail.textContent = s.message || '拉取中...'
        if (s.percent > 0) pullBar.style.width = s.percent + '%'
        if (s.layerCount) {
          const logText = `层进度: ${s.completedLayers || 0}/${s.layerCount} · ${s.percent || 0}%`
          pullLog.textContent = logText
        }
        if (s.status === 'done' || s.status === 'error') clearInterval(pollTimer)
      } catch {}
    }, 800)

    try {
      // Step 1: 拉取镜像
      try {
        await api.dockerPullImage(nodeId, image, tag, requestId)
      } catch (pullErr) {
        const images = await api.dockerListImages(nodeId).catch(() => [])
        const fullImage = `${image}:${tag}`
        const hasLocal = images.some(img => img.tags && img.tags.some(t => t === fullImage))
        if (!hasLocal) throw new Error(`镜像拉取失败: ${pullErr.message}`)
      }
      clearInterval(pollTimer)
      stepPull.classList.remove('active')
      stepPull.classList.add('done')
      pullDetail.textContent = '完成'
      pullBar.style.width = '100%'

      // Step 2: 创建容器
      stepCreate.classList.add('active')
      createDetail.textContent = '创建中...'
      const result = await api.dockerCreateContainer({ nodeId, name, image, tag, panelPort, gatewayPort, envVars })
      stepCreate.classList.remove('active')
      stepCreate.classList.add('done')
      createDetail.textContent = '完成'

      // Step 3: 启动 + 初始化
      stepStart.classList.add('active')
      startDetail.textContent = '启动中...'
      await new Promise(r => setTimeout(r, 1500))

      // 全套初始化：配置同步 + 性格注入 + 记忆同步 + MCP
      const selectedRoleForInject = overlay.querySelector('#dd-role')?.value || 'general'
      const cid = result.id || result.containerId || name
      try {
        startDetail.textContent = '同步配置 & 注入性格...'
        const initResult = await api.dockerInitWorker(nodeId, cid, selectedRoleForInject)
        const synced = initResult?.files?.length || 0
        startDetail.textContent = `已同步 ${synced} 个文件`
        console.log('[deploy] 初始化结果:', initResult)
      } catch (e) {
        console.warn('[deploy] 初始化警告:', e.message)
        startDetail.textContent = '初始化部分失败（不影响运行）'
      }
      await new Promise(r => setTimeout(r, 500))

      stepStart.classList.remove('active')
      stepStart.classList.add('done')
      startDetail.textContent = '运行中'

      // 成功页面
      const host = location.hostname || 'localhost'
      const panelUrl = `${location.protocol}//${host}:${panelPort}`
      const selectedRole = overlay.querySelector('#dd-role')?.value || 'general'
      const roleInfo = MILITARY.roles[selectedRole] || MILITARY.roles.general

      dialog.innerHTML = `
        <div style="text-align:center;padding:20px 0">
          <div style="margin-bottom:12px">${pixelRole(selectedRole, 56)}</div>
          <div style="font-size:18px;font-weight:700;margin-bottom:6px">龙虾入列！</div>
          <div style="color:var(--text-secondary);font-size:13px;margin-bottom:20px">${esc(result.name || name)} 已加入军团 · ${roleInfo.title}</div>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <a href="${panelUrl}" target="_blank" rel="noopener" class="btn btn-primary" style="text-decoration:none">${icon('monitor', 14)} 打开面板</a>
            <button class="btn" data-dismiss>关闭</button>
          </div>
          <div style="margin-top:16px;font-size:11px;color:var(--text-tertiary);font-family:var(--font-mono)">
            Panel: ${panelUrl} · Gateway: ${location.protocol === 'https:' ? 'wss' : 'ws'}://${host}:${gatewayPort}
          </div>
        </div>
      `
      overlay.querySelector('[data-dismiss]').onclick = () => overlay.remove()
      await loadClusterOverview(page)
    } catch (e) {
      clearInterval(pollTimer)
      dialog.innerHTML = `
        <div style="text-align:center;padding:20px 0">
          <div style="font-size:48px;margin-bottom:12px;color:var(--danger,#e53e3e)">${icon('x-circle', 48)}</div>
          <div style="font-size:16px;font-weight:700;margin-bottom:6px;color:var(--danger,#e53e3e)">部署失败</div>
          <div style="color:var(--text-secondary);font-size:13px;margin-bottom:20px;white-space:pre-wrap;max-width:400px;margin-left:auto;margin-right:auto">${esc(e.message)}</div>
          <button class="btn" data-dismiss>关闭</button>
        </div>
      `
      overlay.querySelector('[data-dismiss]').onclick = () => overlay.remove()
    }
  }
}

async function showInspectDialog(page, nodeId, containerId) {
  const c = _lastContainers.find(x => x.id === containerId) || {}
  const isRunning = c.state === 'running'
  const ports = _parseHostPorts(c.ports)
  const host = location.hostname || 'localhost'
  const role = MILITARY.inferRole(c.name)
  const roleInfo = MILITARY.roles[role]

  const overlay = document.createElement('div')
  overlay.className = 'docker-dialog-overlay'
  overlay.innerHTML = `
    <div class="docker-dialog docker-dialog-wide">
      <div class="docker-dialog-title" style="display:flex;align-items:center;gap:10px">
        <div style="line-height:0">${pixelRole(role, 36)}</div>
        <div>
          <div>${esc(c.name || containerId)}</div>
          <div style="font-size:11px;color:var(--text-tertiary);font-weight:400">${icon(roleInfo.iconName, 12)} ${roleInfo.title} · ${esc(c.id)}</div>
        </div>
        <span class="unit-state ${isRunning ? 'running' : 'stopped'}" style="margin-left:auto">${isRunning ? icon('swords', 12) + ' 出征中' : icon('tent', 12) + ' 休整中'}</span>
      </div>

      <div class="inspect-grid">
        <div class="inspect-section">
          <div class="inspect-section-title">军情概况</div>
          <div class="inspect-row"><span class="inspect-label">装备</span><span class="inspect-value mono">${esc(c.image)}</span></div>
          <div class="inspect-row"><span class="inspect-label">状态</span><span class="inspect-value">${esc(c.status || c.state)}</span></div>
          <div class="inspect-row"><span class="inspect-label">通讯</span><span class="inspect-value mono">${esc(c.ports) || '无'}</span></div>
          <div class="inspect-row"><span class="inspect-label">军营</span><span class="inspect-value">${esc(c.nodeName || nodeId)}</span></div>
        </div>

        ${isRunning && (ports.panel || ports.gateway) ? `
        <div class="inspect-section">
          <div class="inspect-section-title">指挥通道</div>
          <div class="inspect-links">
            ${ports.panel ? `<a href="${location.protocol}//${host}:${ports.panel}" target="_blank" rel="noopener" class="inspect-link-card">
              <span class="inspect-link-icon">${icon('monitor', 20)}</span>
              <span class="inspect-link-text">
                <strong>指挥台</strong>
                <span>${location.protocol}//${host}:${ports.panel}</span>
              </span>
            </a>` : ''}
            ${ports.gateway ? `<div class="inspect-link-card" style="cursor:default;opacity:0.85">
              <span class="inspect-link-icon">${icon('zap', 20)}</span>
              <span class="inspect-link-text">
                <strong>通讯链路 (WebSocket)</strong>
                <span>${location.protocol === 'https:' ? 'wss' : 'ws'}://${host}:${ports.gateway}/ws</span>
              </span>
            </div>` : ''}
          </div>
        </div>
        ` : ''}

        <div class="inspect-section">
          <div class="inspect-section-title">最近战报</div>
          <pre class="docker-logs-content inspect-logs">加载中...</pre>
        </div>
      </div>

      <div class="docker-dialog-actions">
        ${isRunning
          ? `<button class="btn btn-sm" data-action="stop" data-ct="${esc(c.id)}" data-node="${esc(nodeId)}">${icon('stop', 12)} 休整</button>
             <button class="btn btn-sm" data-action="restart" data-ct="${esc(c.id)}" data-node="${esc(nodeId)}">${icon('refresh-cw', 12)} 整编</button>`
          : `<button class="btn btn-sm btn-primary" data-action="start" data-ct="${esc(c.id)}" data-node="${esc(nodeId)}">${icon('play', 12)} 出征</button>`
        }
        <button class="btn btn-sm" id="inspect-logs-refresh">${icon('refresh-cw', 12)} 刷新战报</button>
        <span style="flex:1"></span>
        <button class="btn" data-dismiss>关闭</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  overlay.querySelector('[data-dismiss]').onclick = () => overlay.remove()
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })

  // 内联操作按钮
  for (const btn of overlay.querySelectorAll('[data-action]')) {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.action
      btn.disabled = true
      try {
        if (act === 'start') await api.dockerStartContainer(nodeId, containerId)
        else if (act === 'stop') await api.dockerStopContainer(nodeId, containerId)
        else if (act === 'restart') await api.dockerRestartContainer(nodeId, containerId)
        toast(`容器已${act === 'start' ? '启动' : act === 'stop' ? '停止' : '重启'}`)
        overlay.remove()
        await loadClusterOverview(page)
      } catch (e) { toast(e.message, 'error'); btn.disabled = false }
    })
  }

  // 加载日志
  async function loadLogs() {
    const pre = overlay.querySelector('.inspect-logs')
    try {
      const logs = await api.dockerContainerLogs(nodeId, containerId, 50)
      pre.textContent = logs || '（暂无日志）'
      pre.scrollTop = pre.scrollHeight
    } catch (e) {
      pre.textContent = '获取日志失败: ' + e.message
    }
  }
  await loadLogs()
  overlay.querySelector('#inspect-logs-refresh').onclick = loadLogs
}

async function showLogsDialog(page, nodeId, containerId) {
  const overlay = document.createElement('div')
  overlay.className = 'docker-dialog-overlay'
  overlay.innerHTML = `
    <div class="docker-dialog docker-dialog-wide">
      <div class="docker-dialog-title">${icon('scroll', 16)} 战报 <span style="color:var(--text-tertiary);font-size:12px">${esc(containerId)}</span></div>
      <pre class="docker-logs-content">加载中...</pre>
      <div class="docker-dialog-actions">
        <button class="btn" id="dl-refresh">刷新战报</button>
        <button class="btn" data-dismiss>关闭</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  overlay.querySelector('[data-dismiss]').onclick = () => overlay.remove()
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })

  async function loadLogs() {
    const pre = overlay.querySelector('.docker-logs-content')
    try {
      const logs = await api.dockerContainerLogs(nodeId, containerId, 200)
      pre.textContent = logs || '（暂无战报）'
      pre.scrollTop = pre.scrollHeight
    } catch (e) {
      pre.textContent = '战报获取失败: ' + e.message
    }
  }
  await loadLogs()
  overlay.querySelector('#dl-refresh').onclick = loadLogs
}
