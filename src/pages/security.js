/**
 * 安全设置页面 — 访问密码管理 & 无视风险模式
 * 支持 Web 部署模式和 Tauri 桌面端
 */
import { toast } from '../components/toast.js'
import { statusIcon } from '../lib/icons.js'

const isTauri = !!window.__TAURI_INTERNALS__
let _tauriApi = null
let _oauthReveal = null

async function getTauriApi() {
  if (!_tauriApi) _tauriApi = (await import('../lib/tauri-api.js')).api
  return _tauriApi
}

async function apiCall(cmd, args = {}) {
  if (isTauri) {
    // 桌面端：通过 Tauri IPC 读写 clawpanel.json
    const api = await getTauriApi()
    const cfg = await api.readPanelConfig()

    if (cmd === 'auth_status') {
      const isDefault = cfg.accessPassword === '123456'
      const result = { hasPassword: !!cfg.accessPassword, mustChangePassword: isDefault, ignoreRisk: !!cfg.ignoreRisk }
      if (isDefault) result.defaultPassword = '123456'
      return result
    }
    if (cmd === 'auth_change_password') {
      if (cfg.accessPassword && args.oldPassword !== cfg.accessPassword) throw new Error('当前密码错误')
      const weakErr = checkPasswordStrengthLocal(args.newPassword)
      if (weakErr) throw new Error(weakErr)
      if (args.newPassword === cfg.accessPassword) throw new Error('新密码不能与旧密码相同')
      cfg.accessPassword = args.newPassword
      delete cfg.mustChangePassword
      delete cfg.ignoreRisk
      await api.writePanelConfig(cfg)
      sessionStorage.setItem('clawpanel_authed', '1')
      return { success: true }
    }
    if (cmd === 'auth_ignore_risk') {
      if (args.enable) {
        delete cfg.accessPassword
        delete cfg.mustChangePassword
        cfg.ignoreRisk = true
        sessionStorage.removeItem('clawpanel_authed')
      } else {
        delete cfg.ignoreRisk
      }
      await api.writePanelConfig(cfg)
      return { success: true }
    }
    throw new Error('未知命令: ' + cmd)
  }
  // Web 模式
  const resp = await fetch(`/__api/${cmd}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
  return data
}

function checkPasswordStrengthLocal(pw) {
  if (!pw || pw.length < 6) return '密码至少 6 位'
  if (pw.length > 64) return '密码不能超过 64 位'
  if (/^\d+$/.test(pw)) return '密码不能是纯数字'
  const weak = ['123456', '654321', 'password', 'admin', 'qwerty', 'abc123', '111111', '000000', 'letmein', 'welcome', 'clawpanel', 'openclaw']
  if (weak.includes(pw.toLowerCase())) return '密码太常见，请换一个更安全的密码'
  return null
}

function strengthLevel(pw) {
  if (!pw) return { level: 0, text: '', color: '' }
  if (pw.length < 6) return { level: 1, text: '太短', color: 'var(--error)' }
  if (/^\d+$/.test(pw)) return { level: 1, text: '纯数字太弱', color: 'var(--error)' }
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^a-zA-Z0-9]/.test(pw)) score++
  if (score <= 1) return { level: 2, text: '一般', color: 'var(--warning)' }
  if (score <= 3) return { level: 3, text: '良好', color: 'var(--primary)' }
  return { level: 4, text: '强', color: 'var(--success)' }
}

function escHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escShell(value) {
  return String(value || '').replace(/(["\\$`])/g, '\\$1')
}

function formatDateTime(ts) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return '—'
  }
}

function buildOauthCurlSnippet(reveal) {
  if (!reveal?.clientId || !reveal?.clientSecret) return ''
  const origin = window.location.origin
  const clientId = escShell(reveal.clientId)
  const clientSecret = escShell(reveal.clientSecret)
  return [
    `curl -s ${origin}/oauth/token \\`,
    `  -u "${clientId}:${clientSecret}" \\`,
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -d "grant_type=client_credentials&scope=panel:admin"',
    '',
    `curl -s ${origin}/oauth/token \\`,
    `  -u "${clientId}:${clientSecret}" \\`,
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -d "grant_type=refresh_token&refresh_token=<your_refresh_token>"',
    '',
    `curl -s ${origin}/__api/get_services_status \\`,
    '  -H "Content-Type: application/json" \\',
    '  -H "Authorization: Bearer <your_access_token>" \\',
    "  -d '{}'",
  ].join('\n')
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header"><h1>安全设置</h1></div>
    <div id="security-content">
      <div class="config-section loading-placeholder" style="height:120px"></div>
    </div>
  `

  loadStatus(page)
  return page
}

async function loadStatus(page) {
  const container = page.querySelector('#security-content')
  try {
    const status = await apiCall('auth_status')
    let oauthStatus = null
    if (!isTauri) {
      try {
        oauthStatus = await apiCall('get_oauth_status')
      } catch (e) {
        oauthStatus = { enabled: false, reason: e.message, clients: [], loadError: e.message }
      }
    }
    renderContent(container, status, oauthStatus)
  } catch (e) {
    container.innerHTML = `<div class="config-section"><p style="color:var(--error)">加载失败: ${e.message}</p></div>`
  }
}

function renderOauthSection(oauthStatus) {
  if (!oauthStatus) return ''
  const clients = Array.isArray(oauthStatus.clients) ? oauthStatus.clients : []
  const statusColor = oauthStatus.enabled ? 'var(--success)' : 'var(--warning)'
  const statusText = oauthStatus.enabled ? '已启用' : '已禁用'
  const summary = oauthStatus.loadError
    ? `加载 OAuth 状态失败：${escHtml(oauthStatus.loadError)}`
    : (oauthStatus.enabled
      ? '支持 client_credentials + refresh_token，面向自动化部署与服务端集成。'
      : escHtml(oauthStatus.reason || '请先设置面板访问密码后再启用 OAuth API。'))

  const revealHtml = _oauthReveal
    ? `
      <div style="margin-top:14px;padding:14px 16px;border-radius:var(--radius-sm);border:1px solid rgba(34,197,94,0.22);background:rgba(34,197,94,0.08)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px">
          <div style="font-weight:600;color:var(--text-primary)">新凭证已生成，请立即保存</div>
          <button class="btn btn-secondary btn-sm" id="btn-dismiss-oauth-secret">我已保存</button>
        </div>
        <div style="font-size:12px;color:var(--text-secondary);line-height:1.7">
          <div><strong>client_id</strong>: <code>${escHtml(_oauthReveal.clientId)}</code></div>
          <div><strong>client_secret</strong>: <code>${escHtml(_oauthReveal.clientSecret)}</code></div>
        </div>
        <pre style="margin-top:12px;background:var(--bg-tertiary);padding:12px;border-radius:var(--radius-sm);overflow:auto;font-size:12px;line-height:1.6;white-space:pre-wrap">${escHtml(buildOauthCurlSnippet(_oauthReveal))}</pre>
      </div>
    `
    : ''

  const createHtml = oauthStatus.enabled ? `
    <div style="margin-top:16px;padding:14px 16px;border-radius:var(--radius-sm);background:var(--bg-tertiary);border:1px solid var(--border-primary)">
      <div style="font-weight:600;color:var(--text-primary);margin-bottom:10px">创建 OAuth Client</div>
      <form id="form-create-oauth-client" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;align-items:end">
        <div>
          <label style="display:block;font-size:var(--font-size-xs);color:var(--text-tertiary);margin-bottom:4px">名称</label>
          <input class="form-input" id="oauth-client-name" placeholder="如：Deploy Controller" style="width:100%">
        </div>
        <div>
          <label style="display:block;font-size:var(--font-size-xs);color:var(--text-tertiary);margin-bottom:4px">Client ID（可选）</label>
          <input class="form-input" id="oauth-client-id" placeholder="留空自动生成" style="width:100%">
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="submit" class="btn btn-primary btn-sm">创建 Client</button>
          <span id="oauth-create-msg" style="font-size:11px;color:var(--text-tertiary)"></span>
        </div>
      </form>
      <div style="margin-top:8px;font-size:11px;color:var(--text-tertiary)">Access Token 默认 1 小时，Refresh Token 默认 30 天，scope 固定为 <code>panel:admin</code>。</div>
    </div>
  ` : ''

  const clientsHtml = clients.length ? clients.map((client) => `
    <div style="padding:14px 16px;border-radius:var(--radius-sm);background:var(--bg-tertiary);border:1px solid var(--border-primary);margin-top:10px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="min-width:220px;flex:1">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <strong style="color:var(--text-primary)">${escHtml(client.name || client.clientId)}</strong>
            <span style="font-size:11px;padding:2px 8px;border-radius:999px;background:${client.enabled ? 'rgba(34,197,94,.12)' : 'rgba(245,158,11,.14)'};color:${client.enabled ? 'var(--success)' : 'var(--warning)'}">${client.enabled ? '已启用' : '已停用'}</span>
            <span style="font-size:11px;padding:2px 8px;border-radius:999px;background:var(--bg-primary);color:var(--text-tertiary)">${client.source === 'bootstrap' ? '部署预置' : '手工创建'}</span>
          </div>
          <div style="margin-top:6px;font-family:var(--font-mono,monospace);font-size:12px;color:var(--text-secondary)">${escHtml(client.clientId)}</div>
          <div style="margin-top:6px;font-size:11px;color:var(--text-tertiary);line-height:1.7">
            创建于 ${escHtml(formatDateTime(client.createdAt))} · 最近使用 ${escHtml(formatDateTime(client.lastUsedAt))}<br>
            活跃 Access ${client.activeAccessTokens || 0} · 活跃 Refresh ${client.activeRefreshTokens || 0} · 最近轮换 ${escHtml(formatDateTime(client.rotatedAt))}
          </div>
        </div>
        ${oauthStatus.enabled ? `
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm" data-oauth-rotate="${escHtml(client.clientId)}">轮换 Secret</button>
            <button class="btn btn-secondary btn-sm" data-oauth-toggle="${escHtml(client.clientId)}" data-next-enabled="${client.enabled ? '0' : '1'}">${client.enabled ? '停用' : '启用'}</button>
            <button class="btn btn-secondary btn-sm" data-oauth-delete="${escHtml(client.clientId)}" style="color:var(--error)">删除</button>
          </div>
        ` : ''}
      </div>
    </div>
  `).join('') : '<div style="margin-top:12px;font-size:12px;color:var(--text-tertiary)">暂无 OAuth Client。你可以在这里手工创建，或由部署系统预置 bootstrap 文件。</div>'

  return `
    <div class="config-section">
      <div class="config-section-title">OAuth API</div>
      <div style="padding:12px 16px;background:var(--bg-tertiary);border-radius:var(--radius-sm);border-left:3px solid ${statusColor}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-weight:600;color:var(--text-primary)">状态：${statusText}</div>
            <div style="font-size:var(--font-size-xs);color:var(--text-secondary);margin-top:4px;line-height:1.6">${summary}</div>
          </div>
          <div style="font-size:11px;color:var(--text-tertiary);line-height:1.7;text-align:right">
            <div>Token 端点：<code>/oauth/token</code></div>
            <div>撤销端点：<code>/oauth/revoke</code></div>
            <div>Bootstrap：<code>${escHtml(oauthStatus.bootstrapPath || '~/.openclaw/clawpanel-oauth-bootstrap.json')}</code></div>
          </div>
        </div>
      </div>
      ${revealHtml}
      ${createHtml}
      <div style="margin-top:16px">
        <div style="font-weight:600;color:var(--text-primary);margin-bottom:8px">已配置 Client</div>
        ${clientsHtml}
      </div>
    </div>
  `
}

function renderContent(container, status, oauthStatus) {
  let html = ''

  // 当前状态
  const stateIcon = status.hasPassword ? statusIcon('ok', 20) : statusIcon('warn', 20)
  const stateText = status.hasPassword
    ? (status.mustChangePassword ? '使用默认密码（需修改）' : '已设置自定义密码')
    : (status.ignoreRisk ? '无视风险模式（无密码）' : '未设置密码')
  const stateColor = status.hasPassword && !status.mustChangePassword ? 'var(--success)' : 'var(--warning)'

  html += `
    <div class="config-section">
      <div class="config-section-title">访问密码状态</div>
      <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;background:var(--bg-tertiary);border-radius:var(--radius-sm);border-left:3px solid ${stateColor}">
        <span style="font-size:20px">${stateIcon}</span>
        <div>
          <div style="font-weight:600;color:var(--text-primary)">${stateText}</div>
          <div style="font-size:var(--font-size-xs);color:var(--text-tertiary);margin-top:2px">
            ${status.hasPassword
              ? (isTauri ? '每次打开应用需输入密码' : '远程访问需输入密码才能进入面板')
              : (isTauri ? '任何人打开应用即可使用' : '任何人都可以直接访问面板')}
          </div>
        </div>
      </div>
    </div>
  `

  // 修改密码区域
  html += `
    <div class="config-section">
      <div class="config-section-title">${status.hasPassword ? '修改密码' : '设置密码'}</div>
      <form id="form-change-pw" style="max-width:400px">
        ${status.hasPassword ? `
          <div style="margin-bottom:12px">
            <label style="display:block;font-size:var(--font-size-xs);color:var(--text-tertiary);margin-bottom:4px">当前密码</label>
            <input type="password" id="sec-old-pw" class="form-input" placeholder="输入当前密码" autocomplete="current-password" style="width:100%"
              ${status.defaultPassword ? `value="${status.defaultPassword}"` : ''}>
            ${status.defaultPassword ? '<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">已自动填充默认密码，直接设置新密码即可</div>' : ''}
          </div>
        ` : ''}
        <div style="margin-bottom:12px">
          <label style="display:block;font-size:var(--font-size-xs);color:var(--text-tertiary);margin-bottom:4px">新密码</label>
          <input type="password" id="sec-new-pw" class="form-input" placeholder="至少 6 位，不能纯数字" autocomplete="new-password" style="width:100%">
          <div id="pw-strength" style="margin-top:6px;display:flex;align-items:center;gap:8px;min-height:20px"></div>
        </div>
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:var(--font-size-xs);color:var(--text-tertiary);margin-bottom:4px">确认新密码</label>
          <input type="password" id="sec-confirm-pw" class="form-input" placeholder="再次输入新密码" autocomplete="new-password" style="width:100%">
        </div>
        <button type="submit" class="btn btn-primary btn-sm">${status.hasPassword ? '确认修改' : '设置密码'}</button>
        <span id="change-pw-msg" style="margin-left:12px;font-size:var(--font-size-xs)"></span>
      </form>
    </div>
  `

  // 无视风险模式
  html += `
    <div class="config-section">
      <div class="config-section-title" style="display:flex;align-items:center;gap:6px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        无视风险模式
      </div>
      <div style="padding:12px 16px;background:${status.ignoreRisk ? 'rgba(239,68,68,0.08)' : 'var(--bg-tertiary)'};border-radius:var(--radius-sm);border:1px solid ${status.ignoreRisk ? 'rgba(239,68,68,0.2)' : 'var(--border-primary)'}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div>
            <div style="font-weight:500;color:var(--text-primary)">关闭密码保护</div>
            <div style="font-size:var(--font-size-xs);color:var(--text-secondary);margin-top:4px;line-height:1.5">
              开启后任何人都可以直接访问面板，无需输入密码。<br>
              <strong style="color:var(--error)">仅建议在受信任的内网环境中使用。</strong>
            </div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="toggle-ignore-risk" ${status.ignoreRisk ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
      <div id="ignore-risk-confirm" style="display:none;margin-top:12px;padding:12px 16px;background:rgba(239,68,68,0.06);border-radius:var(--radius-sm);border:1px solid rgba(239,68,68,0.15)">
        <p style="font-size:var(--font-size-sm);color:var(--error);font-weight:600;margin-bottom:8px">确认关闭密码保护？</p>
        <p style="font-size:var(--font-size-xs);color:var(--text-secondary);margin-bottom:12px;line-height:1.5">
          关闭后，<strong>任何能访问此服务器 IP 和端口的人</strong>都可以直接进入管理面板，查看和修改你的 AI 配置。
        </p>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm" id="btn-confirm-ignore" style="background:var(--error);color:#fff;border:none">我了解风险，确认关闭</button>
          <button class="btn btn-secondary btn-sm" id="btn-cancel-ignore">取消</button>
        </div>
      </div>
    </div>
  `

  if (!isTauri) {
    html += renderOauthSection(oauthStatus)
  }

  container.innerHTML = html
  bindSecurityEvents(container, status, oauthStatus)
}

function bindSecurityEvents(container, status, oauthStatus) {
  // 密码强度实时显示
  const newPwInput = container.querySelector('#sec-new-pw')
  const strengthEl = container.querySelector('#pw-strength')
  if (newPwInput && strengthEl) {
    newPwInput.addEventListener('input', () => {
      const s = strengthLevel(newPwInput.value)
      if (!newPwInput.value) { strengthEl.innerHTML = ''; return }
      const bars = [1,2,3,4].map(i =>
        `<div style="width:32px;height:4px;border-radius:2px;background:${i <= s.level ? s.color : 'var(--border-primary)'}"></div>`
      ).join('')
      strengthEl.innerHTML = `${bars}<span style="font-size:11px;color:${s.color};font-weight:500">${s.text}</span>`
    })
  }

  // 修改密码表单
  const form = container.querySelector('#form-change-pw')
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const oldPw = container.querySelector('#sec-old-pw')?.value || ''
      const newPw = container.querySelector('#sec-new-pw')?.value || ''
      const confirmPw = container.querySelector('#sec-confirm-pw')?.value || ''
      const msgEl = container.querySelector('#change-pw-msg')
      const btn = form.querySelector('button[type="submit"]')

      if (newPw !== confirmPw) { msgEl.textContent = '两次输入的密码不一致'; msgEl.style.color = 'var(--error)'; return }

      btn.disabled = true
      btn.textContent = '提交中...'
      msgEl.textContent = ''
      try {
        await apiCall('auth_change_password', { oldPassword: oldPw, newPassword: newPw })
        msgEl.textContent = '密码修改成功'
        msgEl.style.color = 'var(--success)'
        toast('密码已更新', 'success')
        // 清除默认密码横幅
        sessionStorage.removeItem('clawpanel_must_change_pw')
        const banner = document.getElementById('pw-change-banner')
        if (banner) banner.remove()
        setTimeout(() => loadStatus(container.closest('.page')), 1000)
      } catch (err) {
        msgEl.textContent = err.message
        msgEl.style.color = 'var(--error)'
        btn.disabled = false
        btn.textContent = status.hasPassword ? '确认修改' : '设置密码'
      }
    })
  }

  // 无视风险模式开关
  const toggle = container.querySelector('#toggle-ignore-risk')
  const confirmBox = container.querySelector('#ignore-risk-confirm')
  if (toggle && confirmBox) {
    toggle.addEventListener('change', () => {
      if (toggle.checked) {
        // 想开启无视风险 → 显示确认框
        confirmBox.style.display = 'block'
        toggle.checked = false // 先不改，等用户确认
      } else {
        // 想关闭无视风险 → 直接关闭，刷新页面引导设密码
        handleIgnoreRisk(container, false)
      }
    })

    container.querySelector('#btn-confirm-ignore')?.addEventListener('click', () => {
      handleIgnoreRisk(container, true)
    })
    container.querySelector('#btn-cancel-ignore')?.addEventListener('click', () => {
      confirmBox.style.display = 'none'
    })
  }

  if (!isTauri) {
    bindOauthEvents(container, oauthStatus)
  }
}

async function handleIgnoreRisk(container, enable) {
  try {
    await apiCall('auth_ignore_risk', { enable })
    if (enable) {
      toast('已开启无视风险模式，密码保护已关闭', 'warning')
      _oauthReveal = null
    } else {
      toast('无视风险模式已关闭，请设置新密码', 'info')
    }
    setTimeout(() => loadStatus(container.closest('.page')), 500)
  } catch (e) {
    toast('操作失败: ' + e.message, 'error')
  }
}

function bindOauthEvents(container, oauthStatus) {
  if (!oauthStatus) return
  const page = container.closest('.page')
  container.querySelector('#btn-dismiss-oauth-secret')?.addEventListener('click', () => {
    _oauthReveal = null
    loadStatus(page)
  })

  const createForm = container.querySelector('#form-create-oauth-client')
  if (createForm) {
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      const name = container.querySelector('#oauth-client-name')?.value?.trim() || ''
      const clientId = container.querySelector('#oauth-client-id')?.value?.trim() || ''
      const msgEl = container.querySelector('#oauth-create-msg')
      const btn = createForm.querySelector('button[type="submit"]')
      if (!name) {
        if (msgEl) msgEl.textContent = '请先填写名称'
        return
      }
      btn.disabled = true
      btn.textContent = '创建中...'
      if (msgEl) msgEl.textContent = ''
      try {
        const result = await apiCall('create_oauth_client', { name, clientId: clientId || null })
        _oauthReveal = {
          clientId: result.clientId,
          clientSecret: result.clientSecret,
          name: result.name || name,
        }
        toast('OAuth Client 已创建', 'success')
        loadStatus(page)
      } catch (err) {
        if (msgEl) msgEl.textContent = err.message
        btn.disabled = false
        btn.textContent = '创建 Client'
      }
    })
  }

  container.querySelectorAll('[data-oauth-rotate]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const clientId = btn.getAttribute('data-oauth-rotate')
      if (!clientId) return
      btn.disabled = true
      try {
        const result = await apiCall('rotate_oauth_client_secret', { clientId })
        _oauthReveal = { clientId: result.clientId, clientSecret: result.clientSecret }
        toast(`已轮换 ${clientId} 的 Secret`, 'success')
        loadStatus(page)
      } catch (err) {
        btn.disabled = false
        toast('轮换失败: ' + err.message, 'error')
      }
    })
  })

  container.querySelectorAll('[data-oauth-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const clientId = btn.getAttribute('data-oauth-toggle')
      const nextEnabled = btn.getAttribute('data-next-enabled') === '1'
      if (!clientId) return
      btn.disabled = true
      try {
        await apiCall('set_oauth_client_enabled', { clientId, enabled: nextEnabled })
        toast(nextEnabled ? `已启用 ${clientId}` : `已停用 ${clientId}`, nextEnabled ? 'success' : 'warning')
        loadStatus(page)
      } catch (err) {
        btn.disabled = false
        toast('操作失败: ' + err.message, 'error')
      }
    })
  })

  container.querySelectorAll('[data-oauth-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const clientId = btn.getAttribute('data-oauth-delete')
      if (!clientId) return
      if (!window.confirm(`确定删除 OAuth Client「${clientId}」吗？这会撤销它的全部 access/refresh token。`)) return
      btn.disabled = true
      try {
        await apiCall('delete_oauth_client', { clientId })
        if (_oauthReveal?.clientId === clientId) _oauthReveal = null
        toast(`已删除 ${clientId}`, 'success')
        loadStatus(page)
      } catch (err) {
        btn.disabled = false
        toast('删除失败: ' + err.message, 'error')
      }
    })
  })
}
