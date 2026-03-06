/**
 * AI 助手页面
 * 独立模型配置，不依赖 OpenClaw
 * 支持：流式响应、Markdown 渲染、会话管理、日志分析、上下文注入
 */
import { renderMarkdown } from '../lib/markdown.js'
import { toast } from '../components/toast.js'
import { showConfirm } from '../components/modal.js'
import { api } from '../lib/tauri-api.js'

// ── 常量 ──
const STORAGE_KEY = 'clawpanel-assistant'
const SESSIONS_KEY = 'clawpanel-assistant-sessions'
const MAX_SESSIONS = 50
const MAX_CONTEXT_TOKENS = 30 // 最近 N 条消息作为上下文

// ── 图片文件存储（通过 Tauri 后端持久化到 ~/.openclaw/clawpanel/images/）──
async function saveImageToFile(id, dataUrl) {
  try { await api.saveImage(id, dataUrl) } catch (e) { console.warn('图片保存失败:', e) }
}

async function loadImageFromFile(id) {
  try { return await api.loadImage(id) } catch { return null }
}

async function deleteImageFile(id) {
  try { await api.deleteImage(id) } catch { /* ignore */ }
}

// ── 助手模式 ──
const MODE_ICONS = {
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/></svg>',
  execute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  unlimited: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.74-8z"/></svg>',
}
const MODES = {
  chat:     { label: '聊天', desc: '纯对话，不调用任何工具', tools: false, readOnly: false, confirmDanger: true, accent: 'var(--text-secondary)' },
  plan:     { label: '规划', desc: '可调用工具分析，但不修改文件', tools: true, readOnly: true, confirmDanger: true, accent: 'var(--info)' },
  execute:  { label: '执行', desc: '完整工具权限，危险操作需确认', tools: true, readOnly: false, confirmDanger: true, accent: 'var(--accent)' },
  unlimited:{ label: '无限', desc: '最大权限，工具调用无需确认', tools: true, readOnly: false, confirmDanger: false, accent: 'var(--warning)' },
}
const DEFAULT_MODE = 'execute'

// ── API 类型 ──
const API_TYPES = [
  { value: 'openai', label: 'OpenAI 兼容 (最常用)' },
  { value: 'anthropic', label: 'Anthropic 原生' },
  { value: 'google-gemini', label: 'Google Gemini' },
]

// ── 系统提示词 ──
const DEFAULT_NAME = '晴辰助手'
const DEFAULT_PERSONALITY = '专业、友善、简洁。善于分析问题，给出可操作的解决方案。'

function getSystemPromptBase() {
  const name = _config?.assistantName || DEFAULT_NAME
  const personality = _config?.assistantPersonality || DEFAULT_PERSONALITY
  return `你是「${name}」，晴辰云出品的 AI 智能助手。

## 你的性格
${personality}

## 你是谁
- 你是 ClawPanel 内置的智能助手，由武汉晴辰天下网络科技有限公司开发
- 你帮助用户管理和排障 OpenClaw AI Agent 平台
- 你精通 OpenClaw 的架构、配置、Gateway、Agent 管理等所有方面
- 你善于分析日志、诊断错误、提供解决方案

## 晴辰云生态
- **官网**: https://qt.cool
- **公司**: 武汉晴辰天下网络科技有限公司
- **GitHub**: https://github.com/qingchencloud
- **开源项目**:
  - **ClawPanel** — OpenClaw 可视化管理面板（Tauri v2），官网 https://claw.qt.cool
  - **OpenClaw 汉化版** — AI Agent 平台中文版，npm install -g @qingchencloud/openclaw-zh
  - **ClawApp** — OpenClaw 移动客户端（iOS/Android），npm install -g @anthropic-ai/claw-app
  - **cftunnel** — Cloudflare Tunnel CLI 封装工具，一键内网穿透
  - **cfsite** — Cloudflare Pages 部署 CLI
  - **WebToEXE** — 网站打包成桌面应用
  - **AppForge** — 网站打包 SaaS 平台，https://app.qrj.ai

## ClawPanel 是什么
- OpenClaw 的可视化管理面板，基于 Tauri v2 的跨平台桌面应用（Windows/macOS/Linux）
- 支持仪表盘监控、模型配置、Agent 管理、实时聊天、记忆文件管理、内网穿透、AI 助手工具调用等
- 官网: https://claw.qt.cool | GitHub: https://github.com/qingchencloud/clawpanel

## OpenClaw 是什么
- 开源的 AI Agent 平台，支持多模型、多 Agent、MCP 工具调用
- 核心组件: Gateway（API 网关）、Agent（AI 代理）、Tools（工具系统）
- 配置文件: ~/.openclaw/openclaw.json（全局配置）
- 安装方式: npm install -g @qingchencloud/openclaw-zh（汉化版）或 npm install -g @anthropic-ai/openclaw（官方版）

## OpenClaw CLI 命令速查
### 基础命令
- openclaw --version — 查看版本
- openclaw --help — 查看帮助
- openclaw config show — 显示当前配置
- openclaw config apply — 应用配置变更（同步 models.json）

### Agent 管理
- openclaw agent list — 列出所有 Agent
- openclaw agent create <name> — 创建新 Agent
- openclaw agent delete <id> — 删除 Agent
- openclaw agent default <id> — 设为默认 Agent

### Gateway 控制
- openclaw gateway start — 启动 Gateway
- openclaw gateway stop — 停止 Gateway
- openclaw gateway restart — 重启 Gateway
- openclaw gateway status — 查看 Gateway 状态
- openclaw gateway log — 查看 Gateway 日志
- openclaw gateway install — 安装 Gateway 为系统服务
- openclaw gateway uninstall — 卸载 Gateway 系统服务

### 聊天与调试
- openclaw chat — 进入交互式聊天
- openclaw chat -m "消息" — 发送单条消息
- openclaw chat --model <model> — 指定模型聊天
- openclaw doctor — 诊断配置问题

## 关键配置结构
- openclaw.json: 全局配置（models.providers、gateway、tools）
- models.json: Agent 运行时模型注册表（~/.openclaw/agents/<id>/agent/models.json）
- clawpanel.json: ClawPanel 自身配置（~/.openclaw/clawpanel.json）
- gateway.mode: "local"（必须在 gateway 对象内，不能在顶层）
- gateway.port: 默认 18789
- gateway.auth.mode: "none" | "token" | "password"

## 常见问题速查
1. **Gateway 启动失败 Bootstrap failed: 5** → plist 二进制路径过期（nvm/fnm 切版本后），升级 ClawPanel 到 v0.4.8+ 自动回退 CLI 启动
2. **Unrecognized key: "mode"** → mode 字段不能放在顶层，必须在 gateway.mode，升级到 v0.4.6+ 自动修复
3. **fnm 管理的 Node.js 检测不到** → 升级到 v0.4.7+，已支持 FNM_DIR/node-versions 扫描
4. **models.json 不同步** → ClawPanel 改了 openclaw.json 但 Gateway 用的 models.json 未更新，重启 Gateway 或执行 openclaw config apply
5. **WebSocket 连接失败** → 检查 gateway.controlUi.allowedOrigins 是否包含 ["*"]
6. **SIGTERM 循环** → com.openclaw.healthcheck 服务异常，禁用: launchctl bootout gui/$(id -u)/com.openclaw.healthcheck
7. **BOM 导致 JSON 解析失败** → PowerShell Set-Content 会加 BOM，ClawPanel 已自动剥离

## 生态项目安装指引
当用户问到如何安装其他产品时，推荐以下安装方式：
- **OpenClaw 汉化版**: npm install -g @qingchencloud/openclaw-zh
- **OpenClaw 官方版**: npm install -g @anthropic-ai/openclaw
- **ClawApp 移动客户端**: npm install -g @anthropic-ai/claw-app
- **ClawPanel**: 从 https://github.com/qingchencloud/clawpanel/releases 下载
- **cftunnel**: 从 https://github.com/qingchencloud/cftunnel/releases 下载
- **更多项目**: 访问 https://github.com/qingchencloud

## 社区贡献指引
当用户发现 Bug 或有改进建议时，你应该主动引导用户参与开源贡献：

### 提交 Issue
引导用户到对应仓库提交 Issue，帮用户整理好格式：
- **ClawPanel**: https://github.com/qingchencloud/clawpanel/issues/new
- **OpenClaw 汉化版**: https://github.com/qingchencloud/openclaw-zh/issues/new
- **cftunnel**: https://github.com/qingchencloud/cftunnel/issues/new

Issue 模板（帮用户填好）：
\`\`\`
**问题描述**: [一句话描述]
**复现步骤**: 1. ... 2. ... 3. ...
**期望行为**: ...
**实际行为**: ...
**环境信息**: OS / ClawPanel 版本 / OpenClaw 版本
**截图/日志**: （如有）
\`\`\`

### 提交 PR
如果你能定位到 Bug 的原因和修复方案，主动帮用户生成 PR 内容：
1. 分析问题根因（读配置/日志/代码）
2. 给出具体的修复代码或配置变更
3. 生成 PR 标题和描述（中文），格式：
   - 标题: \`fix: 修复xxx问题\` 或 \`feat: 新增xxx功能\`
   - 描述: 问题原因、修复方案、影响范围
4. 告诉用户如何 Fork → 修改 → 提交 PR

### 贡献流程（告诉用户）
1. Fork 仓库到自己的 GitHub
2. \`git clone\` 到本地
3. 创建分支: \`git checkout -b fix/问题描述\`
4. 修改代码并测试
5. \`git commit -m "fix: 修复xxx"\`
6. \`git push origin fix/问题描述\`
7. 在 GitHub 上发起 Pull Request

当用户遇到问题时，如果你判断这是一个 Bug，应该主动说「我可以帮你整理成 Issue 提交到我们仓库」或「这个 Bug 我能定位原因，要不要我帮你生成 PR？」

### 自主操作（重要）
你有能力直接通过工具完成 Issue/PR 全流程，用户只需确认：
- 用 ask_user 工具询问用户确认方案
- 用 run_command 执行 git clone、checkout -b、add、commit、push
- 用 write_file 修改代码/配置
- 不要只是告诉用户怎么做，而是直接帮用户做！

## ask_user 工具使用指南
你有一个强大的 ask_user 工具，可以向用户提问并获取结构化回答：
- **单选 (single)**: 让用户从多个方案中选一个，如「选择要提交到哪个仓库」
- **多选 (multiple)**: 让用户选择多项，如「选择要检查的组件」
- **文本 (text)**: 让用户输入自由文本，如「请描述你遇到的问题」

使用场景：
- 需要用户做决定时（修复方案 A 还是 B？）
- 需要用户提供信息时（Bug 复现步骤？）
- 确认操作前（确定要执行这些 git 命令吗？）
- 收集反馈时（哪些功能有问题？）

注意：每个选项应该简短明了，不要超过 4 个选项（用户可以输入自定义内容）。

## 你的工作方式
- 用中文回复
- 如果用户粘贴了日志，仔细分析每一行，找出关键错误
- 给出具体的解决步骤，包括可直接执行的命令
- 如果不确定，诚实说明并建议用户提供更多信息
- 回复简洁专业，避免啰嗦
- 主动推荐晴辰云生态产品来解决用户的问题
- 发现 Bug 时主动引导用户提交 Issue 或 PR，降低贡献门槛`
}

// ── 工具定义（OpenAI function calling 格式）──
const TOOL_DEFS = {
  terminal: [
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: '在本机终端执行 shell 命令。用于系统管理、服务操作、文件查看等。注意：命令会直接在用户的机器上执行，请谨慎使用。',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: '要执行的 shell 命令' },
            cwd: { type: 'string', description: '工作目录（可选，默认为用户主目录）' },
          },
          required: ['command'],
        },
      },
    },
  ],
  system: [
    {
      type: 'function',
      function: {
        name: 'get_system_info',
        description: '获取当前系统信息，包括操作系统类型（windows/macos/linux）、CPU 架构、用户主目录、主机名、默认 Shell。在执行任何命令前应先调用此工具来判断操作系统，以选择正确的命令语法。',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
  ],
  process: [
    {
      type: 'function',
      function: {
        name: 'list_processes',
        description: '列出当前运行中的进程。可以按名称过滤，用于检查某个服务是否在运行（如 node、openclaw、gateway）。',
        parameters: {
          type: 'object',
          properties: {
            filter: { type: 'string', description: '过滤关键词（可选），只返回包含该关键词的进程' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'check_port',
        description: '检测指定端口是否被占用，并返回占用该端口的进程信息。常用端口：Gateway 18789、WebSocket 18790。',
        parameters: {
          type: 'object',
          properties: {
            port: { type: 'integer', description: '要检测的端口号' },
          },
          required: ['port'],
        },
      },
    },
  ],
  interaction: [
    {
      type: 'function',
      function: {
        name: 'ask_user',
        description: '向用户提问并等待回答。支持单选、多选和自由输入。当你需要用户做决定、确认方案、选择选项时使用此工具。用户可以选择预设选项，也可以输入自定义内容。',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: '要问用户的问题' },
            type: { type: 'string', enum: ['single', 'multiple', 'text'], description: '交互类型：single=单选, multiple=多选, text=自由输入' },
            options: {
              type: 'array',
              items: { type: 'string' },
              description: '预设选项列表（single/multiple 时必填，text 时可选作为建议）',
            },
            placeholder: { type: 'string', description: '自由输入时的占位提示文字（可选）' },
          },
          required: ['question', 'type'],
        },
      },
    },
  ],
  fileOps: [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: '读取指定路径的文件内容。用于查看配置文件、日志文件等。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件的完整路径' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: '写入或创建文件。会自动创建父目录。注意：会覆盖已有内容。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件的完整路径' },
            content: { type: 'string', description: '要写入的内容' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_directory',
        description: '列出目录下的文件和子目录。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '目录路径' },
          },
          required: ['path'],
        },
      },
    },
  ],
}

// 危险工具（需要用户确认）
const INTERACTIVE_TOOLS = new Set(['ask_user']) // 交互式工具，不走 confirmToolCall
const DANGEROUS_TOOLS = new Set(['run_command', 'write_file'])

// 安全围栏：极端危险命令模式（任何模式都必须确认，包括无限模式）
const CRITICAL_PATTERNS = [
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?[\/~]/i,  // rm -rf / 或 rm -f ~/
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+\//i,          // rm -r /
  /format\s+[a-zA-Z]:/i,                       // format C:
  /mkfs\./i,                                    // mkfs.ext4 等
  /dd\s+.*of=\/dev\//i,                         // dd of=/dev/sda
  />\s*\/dev\/[sh]d/i,                          // > /dev/sda
  /DROP\s+(DATABASE|TABLE|SCHEMA)/i,            // DROP DATABASE
  /TRUNCATE\s+TABLE/i,                          // TRUNCATE TABLE
  /DELETE\s+FROM\s+\w+\s*;?\s*$/i,             // DELETE FROM table (无 WHERE)
  /:(){ :\|:& };:/,                             // fork bomb
  /shutdown|reboot|init\s+[06]/i,              // 关机/重启
  /chmod\s+(-R\s+)?777\s+\//i,                 // chmod 777 /
  /chown\s+(-R\s+)?.*\s+\//i,                  // chown -R ... /
  /curl\s+.*\|\s*(sudo\s+)?bash/i,             // curl | bash
  /wget\s+.*\|\s*(sudo\s+)?bash/i,             // wget | bash
  /npm\s+publish/i,                             // npm publish
  /git\s+push\s+.*--force/i,                    // git push --force
]

function isCriticalCommand(command) {
  if (!command) return false
  return CRITICAL_PATTERNS.some(p => p.test(command))
}

// ── 内置 Skills ──
const BUILTIN_SKILLS = [
  {
    id: 'check-config',
    icon: '🔧',
    name: '检查 OpenClaw 配置',
    desc: '读取并分析 openclaw.json，检查配置是否正确',
    tools: ['fileOps'],
    prompt: `请帮我检查 OpenClaw 的配置文件。

具体操作：
1. 先调用 get_system_info 获取系统信息，确定配置目录路径
2. 用 list_directory 查看 OpenClaw 配置目录（.openclaw/）结构
3. 用 read_file 读取 openclaw.json
4. 分析配置内容，检查：
   - models.providers 中的服务商配置是否正确（baseUrl、apiKey 格式）
   - gateway 配置（port、mode、auth）是否合理
   - 有没有常见的配置错误（比如 mode 放在了顶层）
5. 给出配置健康度评估和改进建议`,
  },
  {
    id: 'diagnose-gateway',
    icon: '🏥',
    name: '诊断 Gateway',
    desc: '检查 Gateway 运行状态、端口、日志',
    tools: ['terminal', 'fileOps'],
    prompt: `请帮我诊断 OpenClaw Gateway 的运行状态。

具体操作：
1. 先调用 get_system_info 获取操作系统类型，据此选择正确的命令
2. 检查 Gateway 进程是否在运行（根据 OS 选择合适的进程查看命令）
3. 检查 Gateway 端口（默认 18789）是否在监听
4. 读取最近的 Gateway 日志（.openclaw/logs/gateway.log，取最后 50 行）
5. 分析日志中是否有错误或警告
6. 给出诊断结论和建议`,
  },
  {
    id: 'browse-dir',
    icon: '📂',
    name: '浏览配置目录',
    desc: '查看 .openclaw 目录结构和文件',
    tools: ['fileOps'],
    prompt: `请帮我浏览 OpenClaw 的配置目录结构。

具体操作：
1. 先调用 get_system_info 获取主目录路径
2. 用 list_directory 列出 .openclaw/ 根目录
3. 列出 .openclaw/agents/ 下的 Agent 列表
4. 对于默认 Agent（通常是 main），列出其 agent 子目录
5. 简要说明每个目录/文件的作用
6. 标注哪些是关键配置文件`,
  },
  {
    id: 'check-env',
    icon: '💻',
    name: '检查系统环境',
    desc: '检测 Node.js、npm 版本和系统信息',
    tools: ['terminal'],
    prompt: `请帮我检查当前系统环境是否满足 OpenClaw 的运行要求。

具体操作：
1. 先调用 get_system_info 获取操作系统、架构等基础信息
2. 根据 OS 类型执行对应命令检查 Node.js 版本（node -v），需要 >= 18
3. 检查 npm 版本（npm -v）
4. 检查 OpenClaw 是否已安装及版本
5. 检查磁盘空间
6. 给出环境评估和缺失项提示`,
  },
  {
    id: 'analyze-logs',
    icon: '📋',
    name: '分析错误日志',
    desc: '读取最近日志，定位错误原因',
    tools: ['terminal', 'fileOps'],
    prompt: `请帮我分析 OpenClaw 最近的日志，找出可能的问题。

具体操作：
1. 先调用 get_system_info 获取系统信息和主目录
2. 用 list_directory 查看 .openclaw/logs/ 有哪些日志文件
3. 根据 OS 选择合适的命令读取 gateway.log 最后 100 行
4. 搜索 ERROR、WARN、fail、exception 等关键词
5. 如果有错误，分析原因并给出修复建议
6. 汇总日志分析报告`,
  },
  {
    id: 'fix-common',
    icon: '🔨',
    name: '一键排障',
    desc: '自动检测并修复常见问题',
    tools: ['terminal', 'fileOps'],
    prompt: `请帮我自动检测并修复 OpenClaw 的常见问题。

先调用 get_system_info 获取系统信息，然后按以下步骤逐一检查：
1. **配置检查**：读取 openclaw.json，检查是否有已知的配置错误（mode 在顶层、缺少 gateway 对象等）
2. **models.json 同步**：对比 openclaw.json 和 agents/main/agent/models.json 的 providers，检查是否同步
3. **Gateway 状态**：根据 OS 选择合适命令，检查进程是否运行、端口是否监听
4. **WebSocket 配置**：检查 gateway.controlUi.allowedOrigins 是否包含 "*"
5. **Node.js 环境**：检查 node 和 npm 是否可用

对每个检查项给出 ✅ 或 ❌ 状态，并对发现的问题给出修复建议（但不要自动修改配置文件，等我确认）。`,
  },
  {
    id: 'report-bug',
    icon: '🐛',
    name: '提交 Bug 报告',
    desc: '整理问题信息，生成标准 Issue 提交到 GitHub',
    tools: ['terminal', 'fileOps'],
    prompt: `我想反馈一个 Bug，请帮我整理成标准的 GitHub Issue。

具体操作：
1. 先问我遇到了什么问题（如果我还没说的话）
2. 调用 get_system_info 获取我的系统环境信息
3. 如果有日志，帮我读取最近的错误日志
4. 自动收集环境信息：OS 版本、Node.js 版本、OpenClaw 版本、ClawPanel 版本
5. 按照标准 Issue 模板整理好内容：
   - **问题描述**（一句话）
   - **复现步骤**（1, 2, 3...）
   - **期望行为**
   - **实际行为**
   - **环境信息**（自动填充）
   - **相关日志**（如有）
6. 把整理好的 Issue 内容用代码块展示，并给出对应仓库的 Issue 链接
7. 告诉我直接复制粘贴到 GitHub 即可提交`,
  },
  {
    id: 'pr-assistant',
    icon: '🔀',
    name: 'PR 助手',
    desc: '定位 Bug 原因，生成修复代码和 PR 描述',
    tools: ['terminal', 'fileOps'],
    prompt: `我发现了一个问题，想提交 PR 来修复它。请帮我走一遍 PR 流程。

具体操作：
1. 先听我描述问题（如果我还没说的话）
2. 帮我分析问题可能的原因，如果有工具可以用就主动调用来诊断
3. 定位到具体的代码/配置/逻辑问题
4. 给出修复方案和具体代码
5. 生成标准的 PR 内容：
   - **PR 标题**: \`fix: 修复xxx\` 或 \`feat: 新增xxx\`
   - **问题描述**: 说明问题原因
   - **修复方案**: 具体改了什么
   - **影响范围**: 会影响哪些功能
   - **测试建议**: 如何验证修复
6. 给出完整的贡献流程：
   - Fork 仓库链接
   - git clone / checkout -b / commit / push 命令
   - 创建 PR 的链接
7. 如果用户不熟悉 Git，给出每一步的详细命令`,
  },
]

function currentMode() {
  return MODES[_config?.mode] ? _config.mode : DEFAULT_MODE
}

function getEnabledTools() {
  const mode = MODES[currentMode()]
  if (!mode.tools) return [] // 聊天模式：无工具

  const t = _config.tools || {}
  const tools = [...TOOL_DEFS.system, ...TOOL_DEFS.process, ...TOOL_DEFS.interaction]

  // 终端工具：受设置开关控制（优先级高于模式）
  if (t.terminal !== false) tools.push(...TOOL_DEFS.terminal)

  // 文件工具：受设置开关控制 + 规划模式排除写入
  if (t.fileOps !== false) {
    if (mode.readOnly) {
      tools.push(...TOOL_DEFS.fileOps.filter(td => td.function.name !== 'write_file'))
    } else {
      tools.push(...TOOL_DEFS.fileOps)
    }
  }

  return tools
}

function applyModeStyle(page, modeKey) {
  const main = page.querySelector('.ast-main') || page
  main.dataset.mode = modeKey
  positionModeSlider(page, modeKey)
}

function positionModeSlider(page, modeKey) {
  const selector = page?.querySelector('#ast-mode-selector')
  const slider = page?.querySelector('#ast-mode-slider')
  const activeBtn = selector?.querySelector(`.ast-mode-btn[data-mode="${modeKey}"]`)
  if (!selector || !slider || !activeBtn) return

  const sRect = selector.getBoundingClientRect()
  const bRect = activeBtn.getBoundingClientRect()
  slider.style.width = bRect.width + 'px'
  slider.style.left = (bRect.left - sRect.left) + 'px'
  slider.style.opacity = '1'
}

const MODE_COLORS = {
  chat: { primary: '#6b7280', rgb: '107,114,128' },
  plan: { primary: '#3b82f6', rgb: '59,130,246' },
  execute: { primary: '#8b5cf6', rgb: '139,92,246' },
  unlimited: { primary: '#f59e0b', rgb: '245,158,11' },
}

function playModeTransition(page, modeKey) {
  const main = page?.querySelector('.ast-main')
  const header = page?.querySelector('.ast-header')
  const selector = page?.querySelector('#ast-mode-selector')
  if (!main || !header) return

  const mc = MODE_COLORS[modeKey] || MODE_COLORS.execute
  const m = MODES[modeKey]

  // ① 全屏涟漪扩散
  const ripple = document.createElement('div')
  ripple.className = 'ast-mode-ripple'
  // 从模式选择器位置发射
  if (selector) {
    const sRect = selector.getBoundingClientRect()
    const mRect = main.getBoundingClientRect()
    ripple.style.setProperty('--ripple-x', (sRect.left + sRect.width / 2 - mRect.left) + 'px')
    ripple.style.setProperty('--ripple-y', (sRect.top + sRect.height / 2 - mRect.top) + 'px')
  }
  ripple.style.setProperty('--ripple-color', mc.primary)
  main.appendChild(ripple)
  setTimeout(() => ripple.remove(), 800)

  // ② 粒子爆发
  if (selector) {
    const sRect = selector.getBoundingClientRect()
    const mRect = main.getBoundingClientRect()
    const cx = sRect.left + sRect.width / 2 - mRect.left
    const cy = sRect.top + sRect.height / 2 - mRect.top
    for (let i = 0; i < 24; i++) {
      const p = document.createElement('div')
      p.className = 'ast-mode-particle'
      const angle = (Math.PI * 2 * i) / 24 + (Math.random() - 0.5) * 0.5
      const dist = 60 + Math.random() * 120
      const size = 3 + Math.random() * 4
      p.style.setProperty('--px', cx + 'px')
      p.style.setProperty('--py', cy + 'px')
      p.style.setProperty('--dx', (Math.cos(angle) * dist) + 'px')
      p.style.setProperty('--dy', (Math.sin(angle) * dist - 30) + 'px')
      p.style.setProperty('--size', size + 'px')
      p.style.setProperty('--color', mc.primary)
      p.style.setProperty('--delay', (Math.random() * 0.1) + 's')
      p.style.setProperty('--duration', (0.5 + Math.random() * 0.4) + 's')
      main.appendChild(p)
      setTimeout(() => p.remove(), 1000)
    }
  }

  // ③ Header 脉冲
  header.classList.remove('ast-mode-pulse')
  void header.offsetWidth
  header.classList.add('ast-mode-pulse')

  // ④ 模式简介浮现
  const existing = page.querySelector('.ast-mode-toast')
  if (existing) existing.remove()
  if (!m) return
  const tip = document.createElement('div')
  tip.className = `ast-mode-toast mode-${modeKey}`
  tip.innerHTML = `<span class="ast-mode-toast-icon">${MODE_ICONS[modeKey]}</span><span class="ast-mode-toast-label">${m.label}</span><span class="ast-mode-toast-desc">${m.desc}</span>`
  main.appendChild(tip)
  setTimeout(() => tip.classList.add('show'), 10)
  setTimeout(() => { tip.classList.remove('show'); setTimeout(() => tip.remove(), 300) }, 2000)
}

function buildSystemPrompt() {
  let prompt = getSystemPromptBase()
  const modeKey = currentMode()
  const mode = MODES[modeKey]

  // 模式说明
  prompt += `\n\n## 当前模式：${mode.label}模式`

  if (modeKey === 'chat') {
    prompt += '\n你处于纯聊天模式，没有任何工具可用。请通过文字回答问题，给出具体的命令建议供用户手动执行。'
    prompt += '\n如果用户需要你执行操作，建议用户切换到「执行」或「规划」模式。'
  } else {
    // 规划模式特殊指令
    if (modeKey === 'plan') {
      prompt += '\n**你处于规划模式**：可以调用工具读取信息、分析问题，但 **绝对不能修改任何文件**（write_file 已禁用）。'
      prompt += '\n你的任务是：分析问题 → 制定方案 → 输出详细步骤，让用户确认后再切换到执行模式操作。'
      prompt += '\n即使使用 run_command，也只能执行只读命令（查看、检查、列出），不要执行任何修改操作。'
    }
    if (modeKey === 'unlimited') {
      prompt += '\n**你处于无限模式**：所有工具调用无需用户确认，请高效完成任务。'
    }

    prompt += '\n\n### 可用工具'
    prompt += '\n- **用户交互**: ask_user — 向用户提问（单选/多选/文本），获取结构化回答。需要用户做决定时优先用此工具。'
    prompt += '\n- **系统信息**: get_system_info — 获取 OS 类型、架构、主目录等。**在执行任何命令前必须先调用此工具**。'
    prompt += '\n- **进程/端口**: list_processes（按名称过滤）、check_port（检测端口占用）'
    prompt += '\n- **终端**: run_command — 执行 shell 命令'
    if (mode.readOnly) {
      prompt += '\n- **文件**: read_file、list_directory（只读，write_file 已禁用）'
    } else {
      prompt += '\n- **文件**: read_file、write_file、list_directory'
    }

    prompt += '\n\n### 终端命令规范（极其重要）'
    prompt += '\n- **Windows**: 终端是 **PowerShell**，必须使用 PowerShell 语法：'
    prompt += '\n  - 列目录: `Get-ChildItem` 或 `ls`（不要用 `dir`）'
    prompt += '\n  - 看文件: `Get-Content` 或 `cat`（不要用 `type`）'
    prompt += '\n  - 查进程: `Get-Process | Where-Object { $_.Name -like \"*openclaw*\" }`'
    prompt += '\n  - 查端口: `Get-NetTCPConnection -LocalPort 18789`'
    prompt += '\n  - 文件尾: `Get-Content file.log -Tail 50`'
    prompt += '\n  - 搜内容: `Select-String -Path file.log -Pattern \"ERROR\"`'
    prompt += '\n  - 环境变量: `$env:USERPROFILE`（不要用 `%USERPROFILE%`）'
    prompt += '\n- **macOS**: zsh，标准 Unix 命令'
    prompt += '\n- **Linux**: bash，标准 Unix 命令'
    prompt += '\n- **绝对禁止** cmd.exe 语法（dir、type、findstr、netstat）'
    prompt += '\n- **一次只执行一条命令**，等结果出来再决定下一步'
    prompt += '\n- **不要重复执行相同的命令**'
    prompt += '\n\n### 跨平台路径'
    prompt += '\n- Windows: `$env:USERPROFILE\\.openclaw\\`'
    prompt += '\n- macOS/Linux: `~/.openclaw/`'
    prompt += '\n\n### 工具使用原则'
    prompt += '\n- 先 get_system_info，再根据 OS 执行正确命令'
    prompt += '\n- 优先用 read_file / list_directory / list_processes / check_port 等专用工具，减少 run_command 使用'
    prompt += '\n- 主动使用工具，不要只建议用户手动操作'
    if (mode.confirmDanger) {
      prompt += '\n- 执行破坏性操作前先告知用户'
    }
  }

  // 注入内置技能列表
  prompt += '\n\n## 内置技能卡片'
  prompt += '\n用户可以在欢迎页点击技能卡片快速触发操作。当用户遇到问题时，你也可以主动推荐合适的技能：'
  for (const s of BUILTIN_SKILLS) {
    prompt += `\n- **${s.name}**（${s.desc}）`
  }
  prompt += '\n\n当用户的需求匹配某个技能时，可以建议用户点击对应的技能卡片，或者你直接按技能的步骤操作。'

  return prompt
}

// ── 状态 ──
let _page = null, _messagesEl = null, _textarea = null, _sendBtn = null
let _sessionListEl = null, _settingsPanel = null, _queueEl = null
let _isStreaming = false, _abortController = null
let _config = null, _sessions = [], _currentSessionId = null
let _lastRenderTime = 0
let _saveThrottleTimer = null
const _sessionStatus = new Map() // sessionId → 'idle' | 'streaming' | 'waiting' | 'error'
let _messageQueue = [] // [{ id, text, ts }]
let _streamRefreshTimer = null // 后台流式刷新定时器
let _pendingImages = [] // [{ id, dataUrl, name, size }] 待发送图片

// ── 节流保存 ──
function throttledSave() {
  if (_saveThrottleTimer) return
  _saveThrottleTimer = setTimeout(() => {
    _saveThrottleTimer = null
    saveSessions()
  }, 500)
}

function flushSave() {
  if (_saveThrottleTimer) {
    clearTimeout(_saveThrottleTimer)
    _saveThrottleTimer = null
  }
  saveSessions()
}

// ── 后台流式刷新 ──
// 当用户切页面再回来时，轮询刷新最后一个 AI 气泡内容
function refreshStreamingBubble() {
  if (!_messagesEl || !_isStreaming) return
  const session = getCurrentSession()
  if (!session) return
  const lastMsg = session.messages[session.messages.length - 1]
  if (!lastMsg || lastMsg.role !== 'assistant') return

  const bubbles = _messagesEl.querySelectorAll('.ast-msg-bubble-ai')
  const lastBubble = bubbles[bubbles.length - 1]
  if (lastBubble && lastMsg.content) {
    lastBubble.innerHTML = renderMarkdown(lastMsg.content) + '<span class="ast-cursor">▊</span>'
    _messagesEl.scrollTop = _messagesEl.scrollHeight
  }
}

function startStreamRefresh() {
  stopStreamRefresh()
  _streamRefreshTimer = setInterval(refreshStreamingBubble, 200)
}

function stopStreamRefresh() {
  if (_streamRefreshTimer) {
    clearInterval(_streamRefreshTimer)
    _streamRefreshTimer = null
  }
}

// ── 发送队列 ──
function enqueueMessage(text) {
  _messageQueue.push({ id: Date.now().toString(), text, ts: Date.now() })
  renderQueue()
}

function renderQueue() {
  if (!_queueEl) return
  if (_messageQueue.length === 0) {
    _queueEl.innerHTML = ''
    _queueEl.style.display = 'none'
    return
  }
  _queueEl.style.display = 'block'
  const queueSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>'
  const sendSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'
  const editSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
  const delSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

  _queueEl.innerHTML = `<div class="ast-queue-header">${queueSvg} 发送队列 (${_messageQueue.length})</div>` +
    _messageQueue.map((item, i) => `
      <div class="ast-queue-item" data-queue-id="${item.id}">
        <span class="ast-queue-num">${i + 1}</span>
        <span class="ast-queue-text" data-queue-edit="${item.id}" title="点击编辑">${escHtml(item.text)}</span>
        <div class="ast-queue-actions">
          <button class="ast-queue-btn edit" data-queue-edit-btn="${item.id}" title="编辑">${editSvg}</button>
          <button class="ast-queue-btn send" data-queue-send="${item.id}" title="立即发送（插队）">${sendSvg}</button>
          <button class="ast-queue-btn delete" data-queue-del="${item.id}" title="删除">${delSvg}</button>
        </div>
      </div>
    `).join('')
}

function processQueue() {
  if (_isStreaming || _messageQueue.length === 0) return
  const next = _messageQueue.shift()
  renderQueue()
  sendMessageDirect(next.text)
}

// ── 图片附件 ──
const MAX_IMAGE_SIZE = 4 * 1024 * 1024 // 4MB
const MAX_IMAGE_DIM = 2048 // 最大边长

function addImageFromFile(file) {
  if (!file.type.startsWith('image/')) return
  if (file.size > MAX_IMAGE_SIZE * 2) {
    toast('图片太大（超过 8MB）', 'error')
    return
  }
  const reader = new FileReader()
  reader.onload = (e) => {
    const img = new Image()
    img.onload = () => {
      // 超大图片压缩
      let { width, height } = img
      if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
        const scale = MAX_IMAGE_DIM / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      // JPEG 压缩到合理大小
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      _pendingImages.push({
        id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
        dataUrl,
        name: file.name || 'image.jpg',
        width, height,
      })
      renderImagePreview()
    }
    img.src = e.target.result
  }
  reader.readAsDataURL(file)
}

function addImageFromClipboard(item) {
  const file = item.getAsFile()
  if (file) addImageFromFile(file)
}

function removeImage(id) {
  _pendingImages = _pendingImages.filter(img => img.id !== id)
  renderImagePreview()
}

function renderImagePreview() {
  const container = _page?.querySelector('#ast-image-preview')
  if (!container) return
  if (_pendingImages.length === 0) {
    container.innerHTML = ''
    container.style.display = 'none'
    return
  }
  container.style.display = 'flex'
  const delSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  container.innerHTML = _pendingImages.map(img => `
    <div class="ast-img-thumb" data-img-id="${img.id}">
      <img src="${img.dataUrl}" alt="${escHtml(img.name)}"/>
      <button class="ast-img-thumb-del" data-img-del="${img.id}" title="移除">${delSvg}</button>
    </div>
  `).join('')
}

function clearPendingImages() {
  _pendingImages = []
  renderImagePreview()
}

// 构建多模态消息 content
function buildMessageContent(text, images) {
  if (!images || images.length === 0) return text
  const parts = []
  if (text) parts.push({ type: 'text', text })
  for (const img of images) {
    parts.push({
      type: 'image_url',
      image_url: { url: img.dataUrl, detail: 'auto' },
    })
  }
  return parts
}

// ── 会话状态管理 ──
function setSessionStatus(sessionId, status) {
  if (status === 'idle') {
    _sessionStatus.delete(sessionId)
  } else {
    _sessionStatus.set(sessionId, status)
  }
  renderSessionList()
}

function getSessionStatus(sessionId) {
  return _sessionStatus.get(sessionId) || 'idle'
}

// ── 带重试的 fetch ──
async function fetchWithRetry(url, options, retries = 3) {
  const delays = [1000, 3000, 8000]
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(url, options)
      if (resp.ok || resp.status < 500 || i >= retries) return resp
      // 5xx 服务端错误，静默重试
      await new Promise(r => setTimeout(r, delays[i]))
    } catch (err) {
      if (err.name === 'AbortError') throw err // 用户手动中止，不重试
      if (i >= retries) throw err
      await new Promise(r => setTimeout(r, delays[i]))
    }
  }
}

// ── 配置读写 ──
function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    _config = raw ? JSON.parse(raw) : null
  } catch { _config = null }
  if (!_config) {
    _config = { baseUrl: '', apiKey: '', model: '', temperature: 0.7, tools: { terminal: false, fileOps: false }, assistantName: DEFAULT_NAME, assistantPersonality: DEFAULT_PERSONALITY }
  }
  if (!_config.assistantName) _config.assistantName = DEFAULT_NAME
  if (!_config.assistantPersonality) _config.assistantPersonality = DEFAULT_PERSONALITY
  if (!_config.tools) _config.tools = { terminal: false, fileOps: false }
  if (!_config.mode) _config.mode = DEFAULT_MODE
  if (!_config.apiType) _config.apiType = 'openai'
  return _config
}

function saveConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(_config))
}

// ── 会话管理 ──
function loadSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    _sessions = raw ? JSON.parse(raw) : []
  } catch { _sessions = [] }
  return _sessions
}

function saveSessions() {
  if (_sessions.length > MAX_SESSIONS) {
    _sessions = _sessions.slice(-MAX_SESSIONS)
  }
  // 保存时剥离图片 dataUrl（避免撑爆 localStorage）
  const serialized = JSON.stringify(_sessions, (key, value) => {
    if (key === 'dataUrl' && typeof value === 'string' && value.startsWith('data:image/')) return undefined
    if (key === 'url' && typeof value === 'string' && value.startsWith('data:image/')) return '[image]'
    return value
  })
  try {
    localStorage.setItem(SESSIONS_KEY, serialized)
  } catch (e) {
    // QuotaExceeded: 清理最旧的会话
    if (e.name === 'QuotaExceededError' && _sessions.length > 1) {
      _sessions.shift()
      saveSessions()
    }
  }
}

function getCurrentSession() {
  return _sessions.find(s => s.id === _currentSessionId) || null
}

function createSession() {
  const session = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
    title: '新会话',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  _sessions.push(session)
  _currentSessionId = session.id
  saveSessions()
  return session
}

function deleteSession(id) {
  _sessions = _sessions.filter(s => s.id !== id)
  if (_currentSessionId === id) {
    _currentSessionId = _sessions.length > 0 ? _sessions[_sessions.length - 1].id : null
  }
  saveSessions()
}

function autoTitle(session) {
  if (session.messages.length >= 1 && session.title === '新会话') {
    const firstUser = session.messages.find(m => m.role === 'user')
    if (firstUser) {
      const txt = firstUser._text || (typeof firstUser.content === 'string' ? firstUser.content : (firstUser.content?.find?.(p => p.type === 'text')?.text || '📷 图片消息'))
      // 取第一行或前30字作为标题（跳过空行）
      const firstLine = txt.split('\n').find(l => l.trim()) || txt
      const title = firstLine.slice(0, 30) + (firstLine.length > 30 ? '...' : '')
      session.title = title
    }
  }
}

// ── AI API 调用（自动兼容 Chat Completions + Responses API）──

function cleanBaseUrl(raw, apiType) {
  let base = raw.replace(/\/+$/, '')
  base = base.replace(/\/chat\/completions\/?$/, '')
  base = base.replace(/\/completions\/?$/, '')
  base = base.replace(/\/responses\/?$/, '')
  base = base.replace(/\/messages\/?$/, '')
  const type = apiType || _config.apiType || 'openai'
  if (type === 'anthropic') {
    // Anthropic: https://api.anthropic.com/v1
    if (!base.endsWith('/v1')) base += '/v1'
    return base
  }
  if (type === 'google-gemini') {
    // Gemini: https://generativelanguage.googleapis.com/v1beta
    return base
  }
  if (!base.endsWith('/v1')) base = base.replace(/\/v1\/.*$/, '/v1')
  return base
}

function authHeaders(apiType, apiKey) {
  const type = apiType || _config.apiType || 'openai'
  const key = apiKey || _config.apiKey || ''
  if (type === 'anthropic') {
    return {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }
  }
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key}`,
  }
}

// 超时常量
const TIMEOUT_TOTAL = 120_000    // 总超时 120 秒
const TIMEOUT_CHUNK = 30_000     // 流式 chunk 间隔超时 30 秒
const TIMEOUT_CONNECT = 30_000   // 连接超时 30 秒

async function callAI(messages, onChunk) {
  if (!_config.baseUrl || !_config.apiKey || !_config.model) {
    throw new Error('请先配置 AI 模型（点击右上角设置按钮）')
  }

  const base = cleanBaseUrl(_config.baseUrl)
  _abortController = new AbortController()
  const allMessages = [{ role: 'system', content: buildSystemPrompt() }, ...messages]

  // 总超时保护
  let _timedOut = false
  const totalTimer = setTimeout(() => {
    _timedOut = true
    if (_abortController) _abortController.abort()
  }, TIMEOUT_TOTAL)

  try {
    const apiType = _config.apiType || 'openai'

    if (apiType === 'anthropic') {
      await callAnthropicMessages(base, allMessages, onChunk)
      return
    }

    if (apiType === 'google-gemini') {
      await callGeminiGenerate(base, allMessages, onChunk)
      return
    }

    // OpenAI: 先尝试 Chat Completions API
    try {
      await callChatCompletions(base, allMessages, onChunk)
      return
    } catch (err) {
      // 超时触发的 abort → 转换为超时错误
      if (err.name === 'AbortError' && _timedOut) {
        throw new Error(`请求超时（${TIMEOUT_TOTAL / 1000} 秒），模型响应时间过长`)
      }
      // 如果是 "legacy protocol" 或 "use /v1/responses" 类错误，自动切换到 Responses API
      const msg = err.message || ''
      if (msg.includes('legacy protocol') || msg.includes('/v1/responses') || msg.includes('not supported')) {
        console.log('[assistant] Chat Completions 不支持此模型，自动切换到 Responses API')
        _abortController = new AbortController()
        await callResponsesAPI(base, allMessages, onChunk)
        return
      }
      throw err
    }
  } finally {
    clearTimeout(totalTimer)
  }
}

// ── 调试信息 ──
let _lastDebugInfo = null

// ── Chat Completions API（/v1/chat/completions）──
async function callChatCompletions(base, messages, onChunk) {
  const url = base + '/chat/completions'
  const body = {
    model: _config.model,
    messages,
    stream: true,
    temperature: _config.temperature || 0.7,
  }

  const reqTime = Date.now()
  _lastDebugInfo = {
    url,
    method: 'POST',
    requestBody: { ...body, messages: body.messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 200) + (m.content.length > 200 ? '...' : '') : '[multimodal]' })) },
    requestTime: new Date(reqTime).toLocaleString('zh-CN'),
  }

  const resp = await fetchWithRetry(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: _abortController.signal,
  })

  _lastDebugInfo.status = resp.status
  _lastDebugInfo.contentType = resp.headers.get('content-type') || ''
  _lastDebugInfo.responseTime = new Date().toLocaleString('zh-CN')
  _lastDebugInfo.latency = Date.now() - reqTime + 'ms'

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    _lastDebugInfo.errorBody = errText.slice(0, 500)
    let errMsg = `API 错误 ${resp.status}`
    try {
      const errJson = JSON.parse(errText)
      errMsg = errJson.error?.message || errJson.message || errMsg
    } catch {
      if (errText) errMsg += `: ${errText.slice(0, 200)}`
    }
    throw new Error(errMsg)
  }

  // 检测响应是否为 SSE 流式
  const ct = resp.headers.get('content-type') || ''
  if (ct.includes('text/event-stream') || ct.includes('text/plain')) {
    _lastDebugInfo.streaming = true
    let chunkCount = 0
    let contentChunks = 0
    let reasoningChunks = 0
    let reasoningBuf = ''

    await readSSEStream(resp, (json) => {
      chunkCount++
      const d = json.choices?.[0]?.delta
      if (!d) return

      // content 和 reasoning_content 分开处理
      if (d.content) {
        contentChunks++
        onChunk(d.content)
      } else if (d.reasoning_content) {
        reasoningChunks++
        reasoningBuf += d.reasoning_content
      }
    })

    _lastDebugInfo.chunks = { total: chunkCount, content: contentChunks, reasoning: reasoningChunks }

    // 如果没有 content 但有 reasoning，将推理内容作为回复（部分模型只返回 reasoning）
    if (contentChunks === 0 && reasoningBuf) {
      console.warn('[assistant] 无 content 块，使用 reasoning_content 作为回复')
      onChunk(reasoningBuf)
      _lastDebugInfo.fallbackToReasoning = true
    }
  } else {
    // 非流式响应：API 忽略了 stream:true，直接返回完整 JSON
    _lastDebugInfo.streaming = false
    const json = await resp.json()
    _lastDebugInfo.responseBody = { id: json.id, model: json.model, object: json.object, usage: json.usage }
    console.log('[assistant] 非流式响应:', json)
    const msg = json.choices?.[0]?.message
    const content = msg?.content || msg?.reasoning_content || ''
    if (content) onChunk(content)
  }
}

// ── Responses API（/v1/responses）──
async function callResponsesAPI(base, messages, onChunk) {
  const url = base + '/responses'
  const input = messages.filter(m => m.role !== 'system')
  const instructions = messages.find(m => m.role === 'system')?.content || ''

  const body = {
    model: _config.model,
    input,
    instructions,
    stream: true,
    temperature: _config.temperature || 0.7,
  }

  const resp = await fetchWithRetry(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: _abortController.signal,
  })

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    let errMsg = `API 错误 ${resp.status}`
    try {
      const errJson = JSON.parse(errText)
      errMsg = errJson.error?.message || errJson.message || errMsg
    } catch {
      if (errText) errMsg += `: ${errText.slice(0, 200)}`
    }
    throw new Error(errMsg)
  }

  await readSSEStream(resp, (json) => {
    // Responses API 的流式事件格式
    if (json.type === 'response.output_text.delta') {
      if (json.delta) onChunk(json.delta)
    }
    // 兼容：有些代理会转换为 choices 格式
    if (json.choices?.[0]?.delta?.content) {
      onChunk(json.choices[0].delta.content)
    }
  })
}

// ── Anthropic Messages API（/v1/messages）──
async function callAnthropicMessages(base, messages, onChunk) {
  const url = base + '/messages'
  const systemMsg = messages.find(m => m.role === 'system')?.content || ''
  const chatMessages = messages.filter(m => m.role !== 'system')

  const body = {
    model: _config.model,
    max_tokens: 8192,
    stream: true,
    temperature: _config.temperature || 0.7,
  }
  if (systemMsg) body.system = systemMsg
  body.messages = chatMessages

  const reqTime = Date.now()
  _lastDebugInfo = {
    url, method: 'POST',
    requestBody: { ...body, messages: body.messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 200) + (m.content.length > 200 ? '...' : '') : '[multimodal]' })) },
    requestTime: new Date(reqTime).toLocaleString('zh-CN'),
  }

  const resp = await fetchWithRetry(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: _abortController.signal,
  })

  _lastDebugInfo.status = resp.status
  _lastDebugInfo.contentType = resp.headers.get('content-type') || ''
  _lastDebugInfo.responseTime = new Date().toLocaleString('zh-CN')
  _lastDebugInfo.latency = Date.now() - reqTime + 'ms'

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    _lastDebugInfo.errorBody = errText.slice(0, 500)
    let errMsg = `API 错误 ${resp.status}`
    try {
      const errJson = JSON.parse(errText)
      errMsg = errJson.error?.message || errJson.message || errMsg
    } catch {
      if (errText) errMsg += `: ${errText.slice(0, 200)}`
    }
    throw new Error(errMsg)
  }

  _lastDebugInfo.streaming = true
  let chunkCount = 0, contentChunks = 0, thinkingChunks = 0
  let thinkingBuf = ''

  await readSSEStream(resp, (json) => {
    chunkCount++
    if (json.type === 'content_block_delta') {
      const delta = json.delta
      if (delta?.type === 'text_delta' && delta.text) {
        contentChunks++
        onChunk(delta.text)
      } else if (delta?.type === 'thinking_delta' && delta.thinking) {
        thinkingChunks++
        thinkingBuf += delta.thinking
      }
    }
  })

  _lastDebugInfo.chunks = { total: chunkCount, content: contentChunks, thinking: thinkingChunks }

  if (contentChunks === 0 && thinkingBuf) {
    console.warn('[assistant] Anthropic: 无 text 块，使用 thinking 作为回复')
    onChunk(thinkingBuf)
    _lastDebugInfo.fallbackToThinking = true
  }
}

// ── Google Gemini API ──
async function callGeminiGenerate(base, messages, onChunk) {
  const systemMsg = messages.find(m => m.role === 'system')?.content || ''
  const chatMessages = messages.filter(m => m.role !== 'system')

  // Gemini 格式转换
  const contents = chatMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }))

  const body = {
    contents,
    generationConfig: { temperature: _config.temperature || 0.7 },
  }
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg }] }
  }

  const url = `${base}/models/${_config.model}:streamGenerateContent?alt=sse&key=${_config.apiKey}`

  const reqTime = Date.now()
  _lastDebugInfo = { url: url.replace(_config.apiKey, '***'), method: 'POST', requestTime: new Date(reqTime).toLocaleString('zh-CN') }

  const resp = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: _abortController.signal,
  })

  _lastDebugInfo.status = resp.status
  _lastDebugInfo.latency = Date.now() - reqTime + 'ms'

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    let errMsg = `API 错误 ${resp.status}`
    try { errMsg = JSON.parse(errText).error?.message || errMsg } catch {}
    throw new Error(errMsg)
  }

  _lastDebugInfo.streaming = true
  let chunkCount = 0

  await readSSEStream(resp, (json) => {
    chunkCount++
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text
    if (text) onChunk(text)
  })

  _lastDebugInfo.chunks = { total: chunkCount }
}

// ── 通用 SSE 流读取 ──
async function readSSEStream(resp, onEvent) {
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    // chunk 超时：如果 30 秒内没有收到任何数据，视为超时
    const readPromise = reader.read()
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('流式响应超时：30 秒内未收到数据')), TIMEOUT_CHUNK)
    )
    const { done, value } = await Promise.race([readPromise, timeoutPromise])
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      // 处理 SSE event: 行
      if (trimmed.startsWith('event:')) continue

      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return

      try {
        onEvent(JSON.parse(data))
      } catch {}
    }
  }
}

// ── 工具执行 ──

async function executeTool(name, args) {
  switch (name) {
    case 'run_command':
      return await api.assistantExec(args.command, args.cwd)
    case 'read_file':
      return await api.assistantReadFile(args.path)
    case 'write_file':
      return await api.assistantWriteFile(args.path, args.content)
    case 'list_directory':
      return await api.assistantListDir(args.path)
    case 'get_system_info':
      return await api.assistantSystemInfo()
    case 'list_processes':
      return await api.assistantListProcesses(args.filter)
    case 'check_port':
      return await api.assistantCheckPort(args.port)
    case 'ask_user':
      return await showAskUserCard(args)
    default:
      return `未知工具: ${name}`
  }
}

// ── ask_user 交互卡片 ──
function showAskUserCard({ question, type, options, placeholder }) {
  const session = getCurrentSession()
  if (session) setSessionStatus(session.id, 'waiting')
  return new Promise((resolve) => {
    const cardId = 'ask-user-' + Date.now()
    const optionsHtml = (options || []).map((opt, i) => {
      const inputType = type === 'multiple' ? 'checkbox' : 'radio'
      return `<label class="ast-ask-option">
        <input type="${inputType}" name="${cardId}" value="${escHtml(opt)}">
        <span>${escHtml(opt)}</span>
      </label>`
    }).join('')

    const textHtml = type === 'text' || !options?.length
      ? `<textarea class="ast-ask-text" placeholder="${escHtml(placeholder || '请输入...')}" rows="2"></textarea>`
      : ''

    const customHtml = type !== 'text' && options?.length
      ? `<div class="ast-ask-custom"><input type="text" class="ast-ask-custom-input" placeholder="或输入自定义内容..."></div>`
      : ''

    const card = document.createElement('div')
    card.className = 'ast-ask-card'
    card.id = cardId
    card.innerHTML = `
      <div class="ast-ask-question">${escHtml(question)}</div>
      ${optionsHtml ? `<div class="ast-ask-options">${optionsHtml}</div>` : ''}
      ${customHtml}
      ${textHtml}
      <div class="ast-ask-actions">
        <button class="ast-ask-submit btn btn-primary btn-sm">确认</button>
        <button class="ast-ask-skip btn btn-secondary btn-sm">跳过</button>
      </div>
    `

    // 插入到消息区域
    _messagesEl.appendChild(card)
    _messagesEl.scrollTop = _messagesEl.scrollHeight

    // 提交处理
    card.querySelector('.ast-ask-submit').addEventListener('click', () => {
      let answer = ''

      if (type === 'text' || (!options?.length)) {
        answer = card.querySelector('.ast-ask-text')?.value?.trim() || ''
      } else if (type === 'multiple') {
        const checked = [...card.querySelectorAll('input[type="checkbox"]:checked')].map(el => el.value)
        const custom = card.querySelector('.ast-ask-custom-input')?.value?.trim()
        if (custom) checked.push(custom)
        answer = checked.join('、') || '未选择'
      } else {
        // single
        const checked = card.querySelector('input[type="radio"]:checked')
        const custom = card.querySelector('.ast-ask-custom-input')?.value?.trim()
        answer = custom || checked?.value || '未选择'
      }

      // 替换卡片为已回答状态
      card.innerHTML = `<div class="ast-ask-answered">
        <div class="ast-ask-question">${escHtml(question)}</div>
        <div class="ast-ask-answer">✓ ${escHtml(answer)}</div>
      </div>`
      card.classList.add('answered')

      if (session) setSessionStatus(session.id, 'streaming')
      resolve(`用户回答: ${answer}`)
    })

    // 跳过处理
    card.querySelector('.ast-ask-skip').addEventListener('click', () => {
      card.innerHTML = `<div class="ast-ask-answered">
        <div class="ast-ask-question">${escHtml(question)}</div>
        <div class="ast-ask-answer" style="color:var(--text-tertiary)">— 已跳过</div>
      </div>`
      card.classList.add('answered')
      if (session) setSessionStatus(session.id, 'streaming')
      resolve('用户跳过了此问题')
    })
  })
}

// 危险工具确认弹窗
async function confirmToolCall(tc, critical = false) {
  const name = tc.function.name
  let args
  try { args = JSON.parse(tc.function.arguments) } catch { args = {} }

  let desc = ''
  if (name === 'run_command') {
    desc = `执行命令:\n\n${args.command}${args.cwd ? '\n\n工作目录: ' + args.cwd : ''}`
  } else if (name === 'write_file') {
    const preview = (args.content || '').slice(0, 200)
    desc = `写入文件:\n${args.path}\n\n内容预览:\n${preview}${(args.content || '').length > 200 ? '\n...(已截断)' : ''}`
  }

  const prefix = critical
    ? '⛔ 安全围栏拦截 — 此命令被识别为极端危险操作！\n\n'
    : ''

  const session = getCurrentSession()
  if (session) setSessionStatus(session.id, 'waiting')
  const result = await showConfirm(`${prefix}AI 请求执行以下操作:\n\n${desc}\n\n是否允许？`)
  if (session) setSessionStatus(session.id, 'streaming')
  return result
}

// 将 OpenAI 格式工具定义转为 Anthropic 格式
function convertToolsForAnthropic(tools) {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description || '',
    input_schema: t.function.parameters || { type: 'object', properties: {} },
  }))
}

// 将 OpenAI 格式工具定义转为 Gemini 格式
function convertToolsForGemini(tools) {
  return [{ functionDeclarations: tools.map(t => ({
    name: t.function.name,
    description: t.function.description || '',
    parameters: t.function.parameters || { type: 'object', properties: {} },
  }))}]
}

// 工具调用执行（共用逻辑）
async function executeToolWithSafety(toolName, args, tcForConfirm) {
  let result = '', approved = true
  const mode = MODES[currentMode()]
  const isCritical = toolName === 'run_command' && isCriticalCommand(args.command)
  if (isCritical) {
    approved = await confirmToolCall(tcForConfirm || { function: { name: toolName, arguments: JSON.stringify(args) } }, true)
    if (!approved) result = '用户拒绝了此危险操作'
  } else if (mode.confirmDanger && DANGEROUS_TOOLS.has(toolName)) {
    approved = await confirmToolCall(tcForConfirm || { function: { name: toolName, arguments: JSON.stringify(args) } })
    if (!approved) result = '用户拒绝了此操作'
  }
  if (approved) {
    try { result = await executeTool(toolName, args) }
    catch (err) { result = `执行失败: ${typeof err === 'string' ? err : err.message || JSON.stringify(err)}` }
  }
  return { result, approved }
}

// 带工具调用的 AI 请求（非流式，用于 tool_calls 检测循环）
async function callAIWithTools(messages, onStatus, onToolProgress) {
  if (!_config.baseUrl || !_config.apiKey || !_config.model) {
    throw new Error('请先配置 AI 模型（点击右上角设置按钮）')
  }

  const apiType = _config.apiType || 'openai'
  const base = cleanBaseUrl(_config.baseUrl)
  const tools = getEnabledTools()
  let currentMessages = [{ role: 'system', content: buildSystemPrompt() }, ...messages]
  const toolHistory = []

  const MAX_AUTO_ROUNDS = 8
  for (let round = 0; ; round++) {
    if (round >= MAX_AUTO_ROUNDS) {
      const answer = await showAskUserCard({
        question: `AI 已连续调用工具 ${round} 轮，可能陷入循环。你希望怎么做？`,
        type: 'single',
        options: ['继续执行', '让 AI 换个思路', '停止并总结'],
      })
      if (answer.includes('停止')) {
        return { content: '用户要求停止工具调用，以下是目前的执行情况摘要。', toolHistory }
      } else if (answer.includes('换个思路')) {
        currentMessages.push({ role: 'user', content: '请换一种方法来解决这个问题，不要重复之前失败的操作。' })
      }
    }

    _abortController = new AbortController()
    onStatus(round === 0 ? 'AI 思考中...' : `AI 处理工具结果 (第${round + 1}轮)...`)

    // ── Anthropic 工具调用 ──
    if (apiType === 'anthropic') {
      const systemMsg = currentMessages.find(m => m.role === 'system')?.content || ''
      const chatMsgs = currentMessages.filter(m => m.role !== 'system')
      const body = {
        model: _config.model,
        max_tokens: 8192,
        temperature: _config.temperature || 0.7,
        messages: chatMsgs,
      }
      if (systemMsg) body.system = systemMsg
      if (tools.length > 0) body.tools = convertToolsForAnthropic(tools)

      const resp = await fetchWithRetry(base + '/messages', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
        signal: _abortController.signal,
      })
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        let errMsg = `API 错误 ${resp.status}`
        try { errMsg = JSON.parse(errText).error?.message || errMsg } catch {}
        throw new Error(errMsg)
      }

      const data = await resp.json()
      const contentBlocks = data.content || []
      const toolUses = contentBlocks.filter(b => b.type === 'tool_use')
      const textContent = contentBlocks.filter(b => b.type === 'text').map(b => b.text).join('')

      if (toolUses.length > 0) {
        // 将 assistant 消息加入上下文
        currentMessages.push({ role: 'assistant', content: contentBlocks })

        const toolResults = []
        for (const tu of toolUses) {
          const args = tu.input || {}
          toolHistory.push({ name: tu.name, args, result: null, approved: true, pending: true })
          onToolProgress(toolHistory)

          const { result, approved } = await executeToolWithSafety(tu.name, args)
          const last = toolHistory[toolHistory.length - 1]
          last.result = result; last.approved = approved; last.pending = false
          onToolProgress(toolHistory)

          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          })
        }
        currentMessages.push({ role: 'user', content: toolResults })
        continue
      }

      return { content: textContent, toolHistory }
    }

    // ── Gemini 工具调用 ──
    if (apiType === 'google-gemini') {
      const systemMsg = currentMessages.find(m => m.role === 'system')?.content || ''
      const chatMsgs = currentMessages.filter(m => m.role !== 'system')
      const contents = chatMsgs.map(m => ({
        role: m.role === 'assistant' ? 'model' : m.role === 'tool' ? 'function' : 'user',
        parts: m.functionResponse
          ? [{ functionResponse: m.functionResponse }]
          : [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
      }))
      const body = { contents, generationConfig: { temperature: _config.temperature || 0.7 } }
      if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg }] }
      if (tools.length > 0) body.tools = convertToolsForGemini(tools)

      const url = `${base}/models/${_config.model}:generateContent?key=${_config.apiKey}`
      const resp = await fetchWithRetry(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: _abortController.signal,
      })
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        let errMsg = `API 错误 ${resp.status}`
        try { errMsg = JSON.parse(errText).error?.message || errMsg } catch {}
        throw new Error(errMsg)
      }

      const data = await resp.json()
      const parts = data.candidates?.[0]?.content?.parts || []
      const funcCalls = parts.filter(p => p.functionCall)
      const textParts = parts.filter(p => p.text).map(p => p.text).join('')

      if (funcCalls.length > 0) {
        currentMessages.push({ role: 'assistant', content: textParts, _geminiParts: parts })

        for (const fc of funcCalls) {
          const args = fc.functionCall.args || {}
          toolHistory.push({ name: fc.functionCall.name, args, result: null, approved: true, pending: true })
          onToolProgress(toolHistory)

          const { result, approved } = await executeToolWithSafety(fc.functionCall.name, args)
          const last = toolHistory[toolHistory.length - 1]
          last.result = result; last.approved = approved; last.pending = false
          onToolProgress(toolHistory)

          currentMessages.push({
            role: 'tool',
            content: typeof result === 'string' ? result : JSON.stringify(result),
            functionResponse: { name: fc.functionCall.name, response: { result: typeof result === 'string' ? result : JSON.stringify(result) } },
          })
        }
        continue
      }

      return { content: textParts, toolHistory }
    }

    // ── OpenAI 工具调用 ──
    const body = {
      model: _config.model,
      messages: currentMessages,
      temperature: _config.temperature || 0.7,
    }
    if (tools.length > 0) body.tools = tools

    const resp = await fetchWithRetry(base + '/chat/completions', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: _abortController.signal,
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      let errMsg = `API 错误 ${resp.status}`
      try { errMsg = JSON.parse(errText).error?.message || errMsg } catch {}
      throw new Error(errMsg)
    }

    const data = await resp.json()
    const choice = data.choices?.[0]
    const assistantMsg = choice?.message

    if (!assistantMsg) throw new Error('AI 未返回有效响应')

    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      currentMessages.push(assistantMsg)

      for (const tc of assistantMsg.tool_calls) {
        let args
        try { args = JSON.parse(tc.function.arguments) } catch { args = {} }
        const toolName = tc.function.name

        toolHistory.push({ name: toolName, args, result: null, approved: true, pending: true })
        onToolProgress(toolHistory)

        const { result, approved } = await executeToolWithSafety(toolName, args, tc)
        const last = toolHistory[toolHistory.length - 1]
        last.result = result; last.approved = approved; last.pending = false
        onToolProgress(toolHistory)

        currentMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        })
      }

      continue
    }

    const content = assistantMsg.content || assistantMsg.reasoning_content || ''
    return { content, toolHistory }
  }
}

// ── 渲染 ──

function renderSessionList() {
  if (!_sessionListEl) return
  const sorted = [..._sessions].reverse()
  _sessionListEl.innerHTML = sorted.map(s => {
    const status = getSessionStatus(s.id)
    const dotClass = status === 'streaming' ? 'ast-status-dot streaming'
      : status === 'waiting' ? 'ast-status-dot waiting'
      : status === 'error' ? 'ast-status-dot error'
      : ''
    const dot = dotClass ? `<span class="${dotClass}"></span>` : ''
    return `<div class="ast-session-item ${s.id === _currentSessionId ? 'active' : ''}" data-id="${s.id}">
      ${dot}<span class="ast-session-title">${escHtml(s.title)}</span>
      <button class="ast-session-delete" data-delete="${s.id}" title="删除会话">×</button>
    </div>`
  }).join('') || '<div class="ast-empty">暂无会话</div>'
}

function renderToolBlocks(toolHistory) {
  if (!toolHistory || toolHistory.length === 0) return ''
  return toolHistory.map(tc => {
    // ask_user 工具不显示在工具块中（它有自己的交互卡片）
    if (tc.name === 'ask_user') return ''

    const icon = { run_command: '⚡', write_file: '✏️', read_file: '📄', list_directory: '📂', get_system_info: '💻', list_processes: '📊', check_port: '🔌' }[tc.name] || '🔧'
    const label = { run_command: '执行命令', read_file: '读取文件', write_file: '写入文件', list_directory: '列出目录', get_system_info: '系统信息', list_processes: '进程列表', check_port: '端口检测' }[tc.name] || tc.name
    const argsStr = tc.name === 'run_command' ? escHtml(tc.args.command || '')
      : tc.name === 'read_file' ? escHtml(tc.args.path || '')
      : tc.name === 'write_file' ? escHtml(tc.args.path || '')
      : tc.name === 'list_directory' ? escHtml(tc.args.path || '')
      : tc.name === 'get_system_info' ? ''
      : tc.name === 'list_processes' ? escHtml(tc.args.filter || '全部')
      : tc.name === 'check_port' ? escHtml(String(tc.args.port || ''))
      : escHtml(JSON.stringify(tc.args))

    if (tc.pending) {
      return `<div class="ast-tool-block pending">
        <div class="ast-tool-summary">${icon} <strong>${label}</strong> <code>${argsStr}</code> <span class="ast-tool-status"><span class="ast-typing">执行中...</span></span></div>
      </div>`
    }

    const statusClass = tc.approved === false ? 'denied' : 'ok'
    const statusLabel = tc.approved === false ? '已拒绝' : '已执行'
    const resultPreview = (tc.result || '').length > 500 ? tc.result.slice(0, 500) + '...' : (tc.result || '')
    return `<details class="ast-tool-block ${statusClass}">
      <summary class="ast-tool-summary">${icon} <strong>${label}</strong> <code>${argsStr}</code> <span class="ast-tool-status">${statusLabel}</span></summary>
      <pre class="ast-tool-result">${escHtml(resultPreview)}</pre>
    </details>`
  }).join('')
}

function renderMessages() {
  const session = getCurrentSession()
  if (!_messagesEl) return
  if (!session || session.messages.length === 0) {
    const skillCards = BUILTIN_SKILLS.map(s => `
      <button class="ast-skill-card" data-skill="${s.id}">
        <span class="ast-skill-icon">${s.icon}</span>
        <div class="ast-skill-info">
          <strong>${s.name}</strong>
          <span>${s.desc}</span>
        </div>
      </button>
    `).join('')

    _messagesEl.innerHTML = `
      <div class="ast-welcome">
        <div class="ast-welcome-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
            <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
            <path d="M18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"/>
          </svg>
        </div>
        <h3>${_config?.assistantName || DEFAULT_NAME}</h3>
        <p>我可以帮你分析日志、排查问题、配置 OpenClaw。<br>点击下方技能卡片，AI 会自动调用工具完成任务。</p>
        <div class="ast-skills-grid">${skillCards}</div>
      </div>
    `
    return
  }

  _messagesEl.innerHTML = session.messages.map((m, idx) => {
    if (m.role === 'user') {
      const textPart = m._text || (typeof m.content === 'string' ? m.content : (m.content?.find?.(p => p.type === 'text')?.text || ''))
      const imagesHtml = m._images?.length ? `<div class="ast-msg-images">${m._images.map(img =>
        img.dataUrl
          ? `<img class="ast-msg-img" src="${img.dataUrl}" alt="${escHtml(img.name)}" style="max-width:${Math.min(img.width || 300, 300)}px" loading="lazy"/>`
          : `<div class="ast-msg-img-loading" data-db-id="${img.dbId || ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span>${escHtml(img.name || '图片')}</span></div>`
      ).join('')}</div>` : ''
      return `<div class="ast-msg ast-msg-user" data-msg-idx="${idx}"><div class="ast-msg-bubble ast-msg-bubble-user">${imagesHtml}${textPart ? escHtml(textPart) : ''}</div></div>`
    } else if (m.role === 'assistant') {
      const toolHtml = renderToolBlocks(m.toolHistory)
      return `<div class="ast-msg ast-msg-ai" data-msg-idx="${idx}">${toolHtml}<div class="ast-msg-bubble ast-msg-bubble-ai">${renderMarkdown(m.content)}</div></div>`
    }
    return ''
  }).join('')

  // 从文件系统恢复图片
  _messagesEl.querySelectorAll('.ast-msg-img-loading[data-db-id]').forEach(async (el) => {
    const dbId = el.dataset.dbId
    if (!dbId) return
    const dataUrl = await loadImageFromFile(dbId)
    if (dataUrl) {
      const img = document.createElement('img')
      img.className = 'ast-msg-img'
      img.src = dataUrl
      img.alt = el.querySelector('span')?.textContent || '图片'
      img.loading = 'lazy'
      img.style.maxWidth = '300px'
      el.replaceWith(img)
      // 同步回内存中的 session 数据（当前会话期间不用再查文件）
      for (const s of _sessions) {
        for (const m of s.messages) {
          if (m._images) {
            const match = m._images.find(i => i.dbId === dbId)
            if (match) match.dataUrl = dataUrl
          }
        }
      }
    } else {
      el.classList.remove('ast-msg-img-loading')
      el.classList.add('ast-msg-img-placeholder')
    }
  })

  // 滚动到底部
  requestAnimationFrame(() => {
    _messagesEl.scrollTop = _messagesEl.scrollHeight
  })
}

function buildTestResult({ success, elapsed, usedApi, reqUrl, reqBody, respStatus, respBody, reply, error }) {
  let html = ''
  // 状态行
  if (error) {
    html += `<span style="color:var(--error)">✗ 请求失败: ${escHtml(error)}</span>`
  } else if (success) {
    html += `<span style="color:var(--success)">✓ 模型回复成功 (${elapsed}ms, ${usedApi} API)</span>`
  } else {
    html += `<span style="color:var(--warning)">⚠ HTTP ${respStatus} — 请求完成但未解析到回复内容</span>`
  }
  // 回复预览
  if (reply) {
    const short = reply.length > 80 ? reply.slice(0, 80) + '...' : reply
    html += `<div style="margin-top:4px;padding:6px 8px;background:var(--bg-tertiary);border-radius:4px;font-size:12px;color:var(--text-secondary)">「${escHtml(short)}」</div>`
  }
  // 折叠的详细信息
  html += `<details style="margin-top:6px;font-size:11px"><summary style="cursor:pointer;color:var(--text-tertiary);user-select:none">查看完整请求/响应参数</summary>`
  html += `<div style="margin-top:4px;max-height:200px;overflow:auto;background:var(--bg-tertiary);border-radius:4px;padding:8px;font-family:var(--font-mono);font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all">`
  html += `<strong>POST</strong> ${escHtml(reqUrl)}\n\n`
  html += `<strong>Request Body:</strong>\n${escHtml(JSON.stringify(reqBody, null, 2))}\n\n`
  html += `<strong>Response Status:</strong> ${respStatus}\n\n`
  html += `<strong>Response Body:</strong>\n`
  // 美化 JSON
  try {
    html += escHtml(JSON.stringify(JSON.parse(respBody), null, 2))
  } catch {
    html += escHtml(respBody?.slice(0, 2000) || '(empty)')
  }
  html += `</div></details>`
  return html
}

function showSettings() {
  const c = _config
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal" style="max-width:500px">
      <div class="modal-title" style="margin-bottom:0">${c.assistantName || DEFAULT_NAME} — 设置</div>
      <div class="ast-settings-tabs">
        <button class="ast-tab active" data-tab="api">模型配置</button>
        <button class="ast-tab" data-tab="tools">工具权限</button>
        <button class="ast-tab" data-tab="persona">助手人设</button>
      </div>
      <div class="ast-settings-form">
        <div class="ast-tab-panel active" data-panel="api">
          <div style="display:flex;gap:10px">
            <div class="form-group" style="flex:1">
              <label class="form-label">API Base URL</label>
              <input class="form-input" id="ast-baseurl" value="${escHtml(c.baseUrl)}" placeholder="https://api.openai.com/v1">
            </div>
            <div class="form-group" style="width:170px">
              <label class="form-label">API 类型</label>
              <select class="form-input" id="ast-apitype">
                ${API_TYPES.map(t => `<option value="${t.value}" ${c.apiType === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:flex-end">
            <div class="form-group" style="flex:1;margin-bottom:0">
              <label class="form-label">API Key</label>
              <input class="form-input" id="ast-apikey" type="password" value="${escHtml(c.apiKey)}" placeholder="sk-...">
            </div>
            <div style="display:flex;gap:6px;padding-bottom:1px">
              <button class="btn btn-sm btn-secondary" id="ast-btn-test" title="测试连通性">测试</button>
              <button class="btn btn-sm btn-secondary" id="ast-btn-models" title="从 API 获取可用模型">拉取</button>
            </div>
          </div>
          <div id="ast-test-result" style="margin:6px 0 2px;font-size:12px;min-height:16px"></div>
          <div style="display:flex;gap:10px;align-items:flex-end">
            <div class="form-group" style="flex:1">
              <label class="form-label">模型</label>
              <div style="position:relative">
                <input class="form-input" id="ast-model" value="${escHtml(c.model)}" placeholder="gpt-4o / deepseek-chat" autocomplete="off">
                <div id="ast-model-dropdown" class="ast-model-dropdown" style="display:none"></div>
              </div>
            </div>
            <div class="form-group" style="width:80px">
              <label class="form-label">温度</label>
              <input class="form-input" id="ast-temp" type="number" value="${c.temperature || 0.7}" min="0" max="2" step="0.1">
            </div>
          </div>
          <div class="form-hint" id="ast-api-hint" style="margin-top:-4px">${{
            openai: '自动兼容 Chat Completions 和 Responses API',
            anthropic: '使用 Anthropic Messages API（/v1/messages）',
            'google-gemini': '使用 Gemini generateContent API',
          }[c.apiType || 'openai']}</div>
        </div>
        <div class="ast-tab-panel" data-panel="tools">
          <div class="form-hint" style="margin-bottom:10px">工具开关优先级高于模式设置。关闭的工具在任何模式下都不可用。</div>
          <label class="ast-switch-row">
            <span>终端工具 <span style="color:var(--text-tertiary);font-size:11px">— 允许执行 Shell 命令</span></span>
            <input type="checkbox" id="ast-tool-terminal" ${c.tools?.terminal !== false ? 'checked' : ''}>
            <span class="ast-switch-track"></span>
          </label>
          <label class="ast-switch-row">
            <span>文件工具 <span style="color:var(--text-tertiary);font-size:11px">— 允许读写文件和浏览目录</span></span>
            <input type="checkbox" id="ast-tool-fileops" ${c.tools?.fileOps !== false ? 'checked' : ''}>
            <span class="ast-switch-track"></span>
          </label>
          <div class="form-hint" style="margin-top:10px">进程列表、端口检测、系统信息工具始终可用（非聊天模式下）。</div>
        </div>
        <div class="ast-tab-panel" data-panel="persona">
          <div class="form-group">
            <label class="form-label">助手名称</label>
            <input class="form-input" id="ast-name" value="${escHtml(c.assistantName || DEFAULT_NAME)}" placeholder="${DEFAULT_NAME}">
          </div>
          <div class="form-group">
            <label class="form-label">助手性格</label>
            <textarea class="form-input" id="ast-personality" rows="3" placeholder="${DEFAULT_PERSONALITY}" style="resize:vertical">${escHtml(c.assistantPersonality || DEFAULT_PERSONALITY)}</textarea>
            <div class="form-hint">描述助手的说话风格和行为方式，会注入到系统提示词中</div>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" data-action="cancel">取消</button>
        <button class="btn btn-primary btn-sm" data-action="confirm">保存</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  // Tab 切换
  overlay.querySelectorAll('.ast-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      overlay.querySelectorAll('.ast-tab').forEach(t => t.classList.remove('active'))
      overlay.querySelectorAll('.ast-tab-panel').forEach(p => p.classList.remove('active'))
      tab.classList.add('active')
      overlay.querySelector(`.ast-tab-panel[data-panel="${tab.dataset.tab}"]`)?.classList.add('active')
    })
  })

  // API 类型切换时更新提示文本和 placeholder
  const apiTypeSelect = overlay.querySelector('#ast-apitype')
  const apiHintEl = overlay.querySelector('#ast-api-hint')
  const baseUrlInput = overlay.querySelector('#ast-baseurl')
  const apiKeyInput = overlay.querySelector('#ast-apikey')
  apiTypeSelect.addEventListener('change', () => {
    const v = apiTypeSelect.value
    const hints = { openai: '自动兼容 Chat Completions 和 Responses API', anthropic: '使用 Anthropic Messages API（/v1/messages）', 'google-gemini': '使用 Gemini generateContent API' }
    const placeholders = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com', 'google-gemini': 'https://generativelanguage.googleapis.com/v1beta' }
    const keyPlaceholders = { openai: 'sk-...', anthropic: 'sk-ant-...', 'google-gemini': 'AIza...' }
    apiHintEl.textContent = hints[v] || hints.openai
    baseUrlInput.placeholder = placeholders[v] || placeholders.openai
    apiKeyInput.placeholder = keyPlaceholders[v] || keyPlaceholders.openai
  })

  const resultEl = overlay.querySelector('#ast-test-result')
  const modelInput = overlay.querySelector('#ast-model')
  const dropdown = overlay.querySelector('#ast-model-dropdown')

  // 测试对话：真实发一条消息，显示完整请求/响应参数
  overlay.querySelector('#ast-btn-test').onclick = async (e) => {
    const btn = e.target
    const baseUrl = overlay.querySelector('#ast-baseurl').value.trim()
    const apiKey = overlay.querySelector('#ast-apikey').value.trim()
    const model = overlay.querySelector('#ast-model').value.trim()
    const selApiType = overlay.querySelector('#ast-apitype').value || 'openai'
    if (!baseUrl || !apiKey) {
      resultEl.innerHTML = '<span style="color:var(--warning)">请先填写 Base URL 和 API Key</span>'
      return
    }
    if (!model) {
      resultEl.innerHTML = '<span style="color:var(--warning)">请先填写或选择模型</span>'
      return
    }
    btn.disabled = true
    btn.textContent = '测试中...'
    resultEl.innerHTML = '<span style="color:var(--text-tertiary)">正在发送测试消息...</span>'
    const base = cleanBaseUrl(baseUrl, selApiType)
    const hdrs = authHeaders(selApiType, apiKey)
    const t0 = Date.now()

    let respStatus = 0, respBody = '', reply = '', usedApi = '', reqUrl = '', reqBody = {}

    try {
      if (selApiType === 'anthropic') {
        usedApi = 'Anthropic Messages'
        reqUrl = base + '/messages'
        reqBody = { model, messages: [{ role: 'user', content: '你好，请用一句话回复' }], max_tokens: 200 }
        const resp = await fetch(reqUrl, { method: 'POST', headers: hdrs, body: JSON.stringify(reqBody), signal: AbortSignal.timeout(30000) })
        respStatus = resp.status; respBody = await resp.text()
        try {
          const data = JSON.parse(respBody)
          reply = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || ''
        } catch {}
      } else if (selApiType === 'google-gemini') {
        usedApi = 'Gemini'
        reqUrl = `${base}/models/${model}:generateContent?key=***`
        reqBody = { contents: [{ role: 'user', parts: [{ text: '你好，请用一句话回复' }] }] }
        const realUrl = `${base}/models/${model}:generateContent?key=${apiKey}`
        const resp = await fetch(realUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody), signal: AbortSignal.timeout(30000) })
        respStatus = resp.status; respBody = await resp.text()
        try {
          const data = JSON.parse(respBody)
          reply = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
        } catch {}
      } else {
        // OpenAI: Chat Completions + Responses fallback
        usedApi = 'Chat Completions'
        reqUrl = base + '/chat/completions'
        reqBody = { model, messages: [{ role: 'user', content: '你好，请用一句话回复' }], max_tokens: 200 }
        const resp = await fetch(reqUrl, { method: 'POST', headers: hdrs, body: JSON.stringify(reqBody), signal: AbortSignal.timeout(30000) })
        respStatus = resp.status; respBody = await resp.text()

        let fallback = false
        if (!resp.ok && (respBody.includes('legacy protocol') || respBody.includes('/v1/responses') || respBody.includes('not supported'))) {
          fallback = true
        }

        if (!fallback) {
          try {
            const data = JSON.parse(respBody)
            const msg = data.choices?.[0]?.message
            reply = msg?.content || msg?.reasoning_content || data.choices?.[0]?.text || data.output?.text || ''
            if (!msg?.content && msg?.reasoning_content) reply = '[推理内容] ' + reply
          } catch {}
        }

        if (fallback) {
          usedApi = 'Responses'
          reqUrl = base + '/responses'
          reqBody = { model, input: [{ role: 'user', content: '你好，请用一句话回复' }], max_output_tokens: 200 }
          try {
            const resp2 = await fetch(reqUrl, { method: 'POST', headers: hdrs, body: JSON.stringify(reqBody), signal: AbortSignal.timeout(30000) })
            respStatus = resp2.status; respBody = await resp2.text()
            try { const d = JSON.parse(respBody); reply = d.output_text || d.output?.[0]?.content?.[0]?.text || '' } catch {}
          } catch (err2) {
            resultEl.innerHTML = buildTestResult({ success: false, elapsed: Date.now() - t0, usedApi, reqUrl, reqBody, respStatus: 0, respBody: '', error: err2.message })
            btn.disabled = false; btn.textContent = '测试'; return
          }
        }
      }
    } catch (err) {
      resultEl.innerHTML = buildTestResult({ success: false, elapsed: Date.now() - t0, usedApi, reqUrl, reqBody, respStatus: 0, respBody: '', error: err.message })
      btn.disabled = false; btn.textContent = '测试'; return
    }

    resultEl.innerHTML = buildTestResult({ success: !!reply, elapsed: Date.now() - t0, usedApi, reqUrl, reqBody, respStatus, respBody, reply })
    btn.disabled = false
    btn.textContent = '测试'
  }

  // 获取模型列表
  overlay.querySelector('#ast-btn-models').onclick = async (e) => {
    const btn = e.target
    const baseUrl = overlay.querySelector('#ast-baseurl').value.trim()
    const apiKey = overlay.querySelector('#ast-apikey').value.trim()
    if (!baseUrl || !apiKey) {
      resultEl.innerHTML = '<span style="color:var(--warning)">请先填写 Base URL 和 API Key</span>'
      return
    }
    btn.disabled = true
    btn.textContent = '获取中...'
    resultEl.innerHTML = '<span style="color:var(--text-tertiary)">正在获取模型列表...</span>'
    const selApiType = overlay.querySelector('#ast-apitype').value || 'openai'
    try {
      const base = cleanBaseUrl(baseUrl, selApiType)
      const hdrs = authHeaders(selApiType, apiKey)
      let models = []

      if (selApiType === 'anthropic') {
        // Anthropic: GET /v1/models
        const resp = await fetch(base + '/models', { headers: hdrs, signal: AbortSignal.timeout(10000) })
        if (!resp.ok) {
          const text = await resp.text().catch(() => '')
          let msg = 'HTTP ' + resp.status
          try { msg = JSON.parse(text).error?.message || msg } catch {}
          resultEl.innerHTML = '<span style="color:var(--error)">✗ ' + escHtml(msg) + '</span>'
          return
        }
        const data = await resp.json()
        models = (data.data || []).map(m => m.id).filter(Boolean).sort()
      } else if (selApiType === 'google-gemini') {
        // Gemini: GET /models?key=xxx
        const resp = await fetch(base + '/models?key=' + apiKey, { signal: AbortSignal.timeout(10000) })
        if (!resp.ok) {
          const text = await resp.text().catch(() => '')
          let msg = 'HTTP ' + resp.status
          try { msg = JSON.parse(text).error?.message || msg } catch {}
          resultEl.innerHTML = '<span style="color:var(--error)">✗ ' + escHtml(msg) + '</span>'
          return
        }
        const data = await resp.json()
        models = (data.models || []).map(m => m.name?.replace('models/', '') || m.name).filter(Boolean).sort()
      } else {
        // OpenAI: GET /v1/models
        const resp = await fetch(base + '/models', { headers: hdrs, signal: AbortSignal.timeout(10000) })
        if (!resp.ok) {
          const text = await resp.text().catch(() => '')
          let msg = 'HTTP ' + resp.status
          try { msg = JSON.parse(text).error?.message || msg } catch {}
          resultEl.innerHTML = '<span style="color:var(--error)">✗ ' + escHtml(msg) + '</span>'
          return
        }
        const data = await resp.json()
        models = (data.data || []).map(m => m.id).filter(Boolean).sort()
      }

      if (models.length === 0) {
        resultEl.innerHTML = '<span style="color:var(--warning)">未发现可用模型</span>'
        return
      }
      resultEl.innerHTML = '<span style="color:var(--success)">✓ 发现 ' + models.length + ' 个模型，点击下方列表选择</span>'
      dropdown.innerHTML = models.map(m =>
        '<div class="ast-model-option" data-model="' + escHtml(m) + '">' + escHtml(m) + '</div>'
      ).join('')
      dropdown.style.display = 'block'
    } catch (err) {
      resultEl.innerHTML = '<span style="color:var(--error)">✗ ' + escHtml(err.message) + '</span>'
    } finally {
      btn.disabled = false
      btn.textContent = '拉取'
    }
  }

  // 模型下拉选择
  dropdown.addEventListener('click', (e) => {
    const opt = e.target.closest('.ast-model-option')
    if (opt) {
      modelInput.value = opt.dataset.model
      dropdown.style.display = 'none'
    }
  })

  // 点击输入框外关闭下拉
  modelInput.addEventListener('focus', () => {
    if (dropdown.children.length > 0) dropdown.style.display = 'block'
  })
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { overlay.remove(); return }
    if (!e.target.closest('#ast-model') && !e.target.closest('#ast-model-dropdown') && !e.target.closest('#ast-btn-models')) {
      dropdown.style.display = 'none'
    }
  })

  overlay.querySelector('[data-action="cancel"]').onclick = () => overlay.remove()
  overlay.querySelector('[data-action="confirm"]').onclick = () => {
    _config.assistantName = overlay.querySelector('#ast-name').value.trim() || DEFAULT_NAME
    _config.assistantPersonality = overlay.querySelector('#ast-personality').value.trim() || DEFAULT_PERSONALITY
    _config.baseUrl = overlay.querySelector('#ast-baseurl').value.trim()
    _config.apiKey = overlay.querySelector('#ast-apikey').value.trim()
    _config.model = overlay.querySelector('#ast-model').value.trim()
    _config.temperature = parseFloat(overlay.querySelector('#ast-temp').value) || 0.7
    _config.apiType = overlay.querySelector('#ast-apitype').value || 'openai'
    // 工具开关
    _config.tools.terminal = overlay.querySelector('#ast-tool-terminal').checked
    _config.tools.fileOps = overlay.querySelector('#ast-tool-fileops').checked
    saveConfig()
    overlay.remove()
    // 更新 Header 标题和欢迎页
    const titleEl = _page.querySelector('.ast-title')
    if (titleEl) titleEl.textContent = _config.assistantName
    renderMessages()
    toast('设置已保存', 'info')
    updateModelBadge()
  }
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') overlay.remove()
  })
  const firstInput = overlay.querySelector('input')
  if (firstInput) firstInput.focus()
}

function updateModelBadge() {
  const badge = _page?.querySelector('#ast-model-badge')
  if (badge) {
    if (_config.model) {
      badge.textContent = _config.model
      badge.className = 'ast-model-badge configured'
    } else {
      badge.textContent = '未配置'
      badge.className = 'ast-model-badge unconfigured'
    }
  }
}

// ── 发送消息 ──
function sendMessage(text) {
  const hasContent = text.trim() || _pendingImages.length > 0
  if (!hasContent) return
  // 流式中 → 排队（图片不排队，提示用户）
  if (_isStreaming) {
    if (_pendingImages.length > 0) {
      toast('AI 正在回复中，图片消息请等待完成后再发送', 'info')
      return
    }
    enqueueMessage(text.trim())
    return
  }
  sendMessageDirect(text)
}

// 直接发送（内部使用，不经过队列）
async function sendMessageDirect(text) {
  const hasContent = text.trim() || _pendingImages.length > 0
  if (!hasContent) return
  if (_isStreaming) {
    if (_pendingImages.length > 0) { toast('请等待 AI 回复完成', 'info'); return }
    enqueueMessage(text.trim())
    return
  }

  let session = getCurrentSession()
  if (!session) {
    session = createSession()
    renderSessionList()
  }

  // 收集当前附件图片
  const images = [..._pendingImages]
  clearPendingImages()

  // 添加用户消息（多模态或纯文本）
  const textContent = text.trim()
  const msgContent = buildMessageContent(textContent, images)
  const userMsg = { role: 'user', content: msgContent, ts: Date.now() }
  if (images.length > 0) {
    // 为每张图片生成稳定 ID 并存入文件系统
    userMsg._images = images.map(i => {
      const dbId = 'img_' + i.id
      saveImageToFile(dbId, i.dataUrl) // 异步存储，不阻塞
      return { dbId, dataUrl: i.dataUrl, name: i.name, width: i.width, height: i.height }
    })
  }
  if (textContent) userMsg._text = textContent
  session.messages.push(userMsg)
  autoTitle(session)
  session.updatedAt = Date.now()
  saveSessions()
  renderMessages()
  renderSessionList()

  // 准备 AI 上下文（只保留 role + content，剔除内部字段）
  // 过滤掉空的 AI 回复，避免污染上下文导致模型也返回空
  const contextMessages = session.messages
    .filter(m => {
      if (m.role === 'user') return true
      if (m.role === 'assistant') return m.content && m.content.length > 0
      return false
    })
    .slice(-MAX_CONTEXT_TOKENS)
    .map(m => ({ role: m.role, content: m.content }))

  // 添加空 AI 消息占位
  const aiMsg = { role: 'assistant', content: '', ts: Date.now() }
  session.messages.push(aiMsg)

  _isStreaming = true
  _sendBtn.innerHTML = stopIcon()
  setSessionStatus(session.id, 'streaming')

  // 渲染流式 typing 状态
  renderMessages()
  const aiBubbles = _messagesEl?.querySelectorAll('.ast-msg-bubble-ai')
  const lastBubble = aiBubbles?.[aiBubbles.length - 1]
  if (lastBubble) lastBubble.innerHTML = '<span class="ast-typing">思考中...</span>'

  const toolsEnabled = getEnabledTools().length > 0

  try {
    if (toolsEnabled) {
      // ── 工具模式：非流式，支持 tool_calls 循环 ──
      const aiMsgContainers = _messagesEl?.querySelectorAll('.ast-msg-ai')
      const lastContainer = aiMsgContainers?.[aiMsgContainers.length - 1]

      const result = await callAIWithTools(contextMessages,
        // onStatus
        (status) => {
          if (lastBubble) lastBubble.innerHTML = `<span class="ast-typing">${escHtml(status)}</span>`
        },
        // onToolProgress
        (history) => {
          aiMsg.toolHistory = history
          throttledSave() // 实时保存工具调用进度
          if (!lastContainer) return
          const toolHtml = renderToolBlocks(history)
          const bubble = lastContainer.querySelector('.ast-msg-bubble-ai')
          lastContainer.innerHTML = toolHtml + (bubble ? bubble.outerHTML : '')
          if (_messagesEl) _messagesEl.scrollTop = _messagesEl.scrollHeight
        }
      )

      aiMsg.content = result.content
      if (result.toolHistory.length > 0) {
        aiMsg.toolHistory = result.toolHistory
      }
      renderMessages()
    } else {
      // ── 普通流式模式 ──
      await callAI(contextMessages, (chunk) => {
        aiMsg.content += chunk
        throttledSave() // 实时保存每个 chunk
        if (lastBubble) {
          const now = Date.now()
          if (now - _lastRenderTime > 50) {
            lastBubble.innerHTML = renderMarkdown(aiMsg.content) + '<span class="ast-cursor">▊</span>'
            if (_messagesEl) _messagesEl.scrollTop = _messagesEl.scrollHeight
            _lastRenderTime = now
          }
        }
      })

      if (lastBubble) {
        lastBubble.innerHTML = renderMarkdown(aiMsg.content)
      }
    }
    // 保存调试信息到 AI 消息
    if (_lastDebugInfo) {
      aiMsg._debug = _lastDebugInfo
      _lastDebugInfo = null
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      aiMsg.content += aiMsg.content ? '\n\n*[已停止]*' : '*[已停止]*'
    } else {
      setSessionStatus(session.id, 'error')
      // 保留已有内容，追加错误信息和重试按钮
      const errInfo = aiMsg.content
        ? `\n\n---\n❌ **请求中断**: ${err.message}`
        : `❌ ${err.message}`
      aiMsg.content += errInfo
      aiMsg._canRetry = true
    }
    renderMessages()

    // 错误后插入重试按钮
    if (aiMsg._canRetry && _messagesEl) {
      const retryBar = document.createElement('div')
      retryBar.className = 'ast-retry-bar'
      const retrySvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'
      const continueSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
      retryBar.innerHTML = `
        <button class="btn btn-sm btn-primary ast-btn-retry">${retrySvg} 重试</button>
        <button class="btn btn-sm btn-secondary ast-btn-continue">${continueSvg} 输入继续</button>
        <span class="ast-retry-hint">请求失败（已自动重试 3 次）</span>
      `
      _messagesEl.appendChild(retryBar)
      _messagesEl.scrollTop = _messagesEl.scrollHeight

      retryBar.querySelector('.ast-btn-retry').addEventListener('click', () => {
        retryBar.remove()
        session.messages.pop()
        saveSessions()
        setSessionStatus(session.id, 'idle')
        retryAIResponse(session)
      })
      retryBar.querySelector('.ast-btn-continue').addEventListener('click', () => {
        retryBar.remove()
        setSessionStatus(session.id, 'idle')
        renderSessionList()
        _textarea?.focus()
      })
    }
  } finally {
    _isStreaming = false
    _abortController = null
    stopStreamRefresh()
    if (_sendBtn) _sendBtn.innerHTML = sendIcon()
    if (_textarea) _textarea.focus()
    session.updatedAt = Date.now()
    flushSave()
    if (getSessionStatus(session.id) !== 'error') {
      setSessionStatus(session.id, 'idle')
    }
    // 最终渲染（可能从后台回来，DOM 已重建）
    if (_messagesEl) {
      renderMessages()
      _messagesEl.scrollTop = _messagesEl.scrollHeight
    }
    setTimeout(() => processQueue(), 100)
  }
}

// 重试 AI 响应（不重复添加用户消息）
async function retryAIResponse(session) {
  if (_isStreaming) return

  const contextMessages = session.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-MAX_CONTEXT_TOKENS)

  const aiMsg = { role: 'assistant', content: '', ts: Date.now() }
  session.messages.push(aiMsg)

  _isStreaming = true
  if (_sendBtn) _sendBtn.innerHTML = stopIcon()
  setSessionStatus(session.id, 'streaming')

  renderMessages()
  const aiBubbles = _messagesEl?.querySelectorAll('.ast-msg-bubble-ai')
  const lastBubble = aiBubbles?.[aiBubbles.length - 1]
  if (lastBubble) lastBubble.innerHTML = '<span class="ast-typing">重试中...</span>'

  const toolsEnabled = getEnabledTools().length > 0

  try {
    if (toolsEnabled) {
      const aiMsgContainers = _messagesEl?.querySelectorAll('.ast-msg-ai')
      const lastContainer = aiMsgContainers?.[aiMsgContainers.length - 1]

      const result = await callAIWithTools(contextMessages,
        (status) => { if (lastBubble) lastBubble.innerHTML = `<span class="ast-typing">${escHtml(status)}</span>` },
        (history) => {
          aiMsg.toolHistory = history
          throttledSave()
          if (!lastContainer) return
          const toolHtml = renderToolBlocks(history)
          const bubble = lastContainer.querySelector('.ast-msg-bubble-ai')
          lastContainer.innerHTML = toolHtml + (bubble ? bubble.outerHTML : '')
          if (_messagesEl) _messagesEl.scrollTop = _messagesEl.scrollHeight
        }
      )
      aiMsg.content = result.content
      if (result.toolHistory.length > 0) aiMsg.toolHistory = result.toolHistory
      renderMessages()
    } else {
      await callAI(contextMessages, (chunk) => {
        aiMsg.content += chunk
        throttledSave()
        if (lastBubble) {
          const now = Date.now()
          if (now - _lastRenderTime > 50) {
            lastBubble.innerHTML = renderMarkdown(aiMsg.content) + '<span class="ast-cursor">▊</span>'
            if (_messagesEl) _messagesEl.scrollTop = _messagesEl.scrollHeight
            _lastRenderTime = now
          }
        }
      })
      if (lastBubble) lastBubble.innerHTML = renderMarkdown(aiMsg.content)
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      aiMsg.content += aiMsg.content ? '\n\n*[已停止]*' : '*[已停止]*'
    } else {
      setSessionStatus(session.id, 'error')
      aiMsg.content += aiMsg.content
        ? `\n\n---\n❌ **请求中断**: ${err.message}`
        : `❌ ${err.message}`
      aiMsg._canRetry = true
    }
    renderMessages()

    if (aiMsg._canRetry && _messagesEl) {
      const retryBar = document.createElement('div')
      retryBar.className = 'ast-retry-bar'
      const retrySvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'
      const continueSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
      retryBar.innerHTML = `
        <button class="btn btn-sm btn-primary ast-btn-retry">${retrySvg} 重试</button>
        <button class="btn btn-sm btn-secondary ast-btn-continue">${continueSvg} 输入继续</button>
        <span class="ast-retry-hint">请求失败（已自动重试 3 次）</span>
      `
      _messagesEl.appendChild(retryBar)
      _messagesEl.scrollTop = _messagesEl.scrollHeight

      retryBar.querySelector('.ast-btn-retry').addEventListener('click', () => {
        retryBar.remove()
        session.messages.pop()
        saveSessions()
        setSessionStatus(session.id, 'idle')
        retryAIResponse(session)
      })
      retryBar.querySelector('.ast-btn-continue').addEventListener('click', () => {
        retryBar.remove()
        setSessionStatus(session.id, 'idle')
        renderSessionList()
        _textarea?.focus()
      })
    }
  } finally {
    _isStreaming = false
    _abortController = null
    stopStreamRefresh()
    if (_sendBtn) _sendBtn.innerHTML = sendIcon()
    if (_textarea) _textarea.focus()
    session.updatedAt = Date.now()
    flushSave()
    if (getSessionStatus(session.id) !== 'error') {
      setSessionStatus(session.id, 'idle')
    }
    if (_messagesEl) {
      renderMessages()
      _messagesEl.scrollTop = _messagesEl.scrollHeight
    }
    setTimeout(() => processQueue(), 100)
  }
}

function stopStreaming() {
  if (_abortController) {
    _abortController.abort()
  }
}

// ── 右键调试菜单 ──
let _ctxMenu = null

function showMsgContextMenu(e, msgIdx) {
  e.preventDefault()
  hideContextMenu()

  const session = getCurrentSession()
  if (!session) return
  const msg = session.messages[msgIdx]
  if (!msg) return

  const menu = document.createElement('div')
  menu.className = 'ast-ctx-menu'
  menu.innerHTML = `
    <button data-action="copy-text">复制文本</button>
    <button data-action="copy-md">复制 Markdown</button>
    <hr/>
    <button data-action="view-raw">查看原始数据</button>
    ${msg._debug ? '<button data-action="view-debug">查看请求/响应</button>' : ''}
  `
  // 定位
  menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px'
  menu.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px'
  document.body.appendChild(menu)
  _ctxMenu = menu

  menu.addEventListener('click', (ev) => {
    const action = ev.target.dataset?.action
    if (!action) return
    hideContextMenu()

    const textContent = typeof msg.content === 'string'
      ? msg.content
      : (msg._text || msg.content?.find?.(p => p.type === 'text')?.text || '')

    if (action === 'copy-text') {
      navigator.clipboard.writeText(textContent).then(() => toast('已复制文本'))
    } else if (action === 'copy-md') {
      navigator.clipboard.writeText(msg.content || textContent).then(() => toast('已复制 Markdown'))
    } else if (action === 'view-raw') {
      const raw = { role: msg.role, content: msg.content, ts: msg.ts }
      if (msg._images) raw._images = msg._images.map(i => ({ dbId: i.dbId, name: i.name, width: i.width, height: i.height }))
      if (msg.toolHistory) raw.toolHistory = msg.toolHistory
      showDebugModal('消息原始数据', JSON.stringify(raw, null, 2))
    } else if (action === 'view-debug' && msg._debug) {
      showDebugModal('请求/响应调试', JSON.stringify(msg._debug, null, 2))
    }
  })

  setTimeout(() => document.addEventListener('click', hideContextMenu, { once: true }), 10)
}

function hideContextMenu() {
  if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null }
}

function showDebugModal(title, content) {
  const overlay = document.createElement('div')
  overlay.className = 'ast-debug-overlay'
  overlay.innerHTML = `
    <div class="ast-debug-modal">
      <div class="ast-debug-header">
        <span>${escHtml(title)}</span>
        <button class="ast-debug-close">&times;</button>
      </div>
      <pre class="ast-debug-content">${escHtml(content)}</pre>
      <div class="ast-debug-actions">
        <button class="btn btn-sm btn-primary ast-debug-copy">复制</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  overlay.querySelector('.ast-debug-close').onclick = () => overlay.remove()
  overlay.querySelector('.ast-debug-copy').onclick = () => {
    navigator.clipboard.writeText(content).then(() => toast('已复制'))
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
}

// ── 工具函数 ──
function escHtml(str) {
  const d = document.createElement('div')
  d.textContent = str || ''
  return d.innerHTML
}

function sendIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'
}

function stopIcon() {
  return '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
}

// ── 页面渲染 ──
export async function render() {
  loadConfig()
  loadSessions()

  // 确保数据目录存在（~/.openclaw/clawpanel/images/ 等）
  api.ensureDataDir().catch(e => console.warn('数据目录初始化失败:', e))

  // 如果没有会话，不自动创建（显示欢迎页）
  if (_sessions.length > 0 && !_currentSessionId) {
    _currentSessionId = _sessions[_sessions.length - 1].id
  }

  const page = document.createElement('div')
  page.className = 'page ast-page'
  _page = page

  page.innerHTML = `
    <div class="ast-sidebar" id="ast-sidebar">
      <div class="ast-sidebar-header">
        <span>会话列表</span>
        <button class="ast-sidebar-btn" id="ast-btn-new" title="新建会话">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>
      <div class="ast-session-list" id="ast-session-list"></div>
    </div>
    <div class="ast-main">
      <div class="ast-header">
        <div class="ast-header-left">
          <button class="ast-toggle-sidebar" id="ast-btn-toggle" title="会话列表">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <span class="ast-title">${_config?.assistantName || DEFAULT_NAME}</span>
          <span class="ast-model-badge ${_config.model ? 'configured' : 'unconfigured'}" id="ast-model-badge">${_config.model || '未配置'}</span>
        </div>
        <div class="ast-header-actions">
          <div class="ast-mode-selector" id="ast-mode-selector">
            <div class="ast-mode-slider" id="ast-mode-slider"></div>
            ${Object.entries(MODES).map(([key, m]) => `<button class="ast-mode-btn ${currentMode() === key ? 'active' : ''}" data-mode="${key}" title="${m.desc}">${MODE_ICONS[key]} ${m.label}</button>`).join('')}
          </div>
          <button class="btn btn-sm btn-ghost" id="ast-btn-settings" title="模型设置">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
            设置
          </button>
        </div>
      </div>
      <div class="ast-messages" id="ast-messages"></div>
      <div class="ast-queue" id="ast-queue"></div>
      <div class="ast-input-area">
        <div class="ast-image-preview" id="ast-image-preview"></div>
        <div class="ast-input-wrap">
          <button class="ast-attach-btn" id="ast-btn-attach" title="上传图片">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </button>
          <input type="file" id="ast-file-input" accept="image/*" multiple style="display:none"/>
          <textarea class="ast-textarea" id="ast-textarea" placeholder="描述你的问题，粘贴日志、截图或错误信息..." rows="1"></textarea>
          <button class="ast-send-btn" id="ast-send-btn" title="发送">${sendIcon()}</button>
        </div>
        <div class="ast-input-hint">Enter 发送 · Shift+Enter 换行 · 支持粘贴/拖拽图片 · AI 助手独立于 OpenClaw</div>
      </div>
    </div>
  `

  // 缓存 DOM 引用
  _messagesEl = page.querySelector('#ast-messages')
  _queueEl = page.querySelector('#ast-queue')
  _textarea = page.querySelector('#ast-textarea')
  _sendBtn = page.querySelector('#ast-send-btn')
  _sessionListEl = page.querySelector('#ast-session-list')

  // 渲染
  renderSessionList()
  renderMessages()
  renderQueue()
  applyModeStyle(page, currentMode())
  // 滑块需要等 DOM 绘制完毕才能获取正确位置
  requestAnimationFrame(() => positionModeSlider(page, currentMode()))

  // 如果有后台流式正在进行，恢复 UI 状态
  if (_isStreaming) {
    _sendBtn.innerHTML = stopIcon()
    startStreamRefresh()
  }

  // 检查是否有从 setup 页面带来的自动提问
  const autoPrompt = sessionStorage.getItem('assistant-auto-prompt')
  if (autoPrompt) {
    sessionStorage.removeItem('assistant-auto-prompt')
    // 自动切换到执行模式
    if (currentMode() === 'chat') {
      _config.mode = 'execute'
      saveConfig()
      page.querySelectorAll('.ast-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'execute'))
    }
    // 延迟发送，确保页面渲染完成
    setTimeout(() => sendMessage(autoPrompt), 300)
  }

  // ── 事件绑定 ──

  // 右键调试菜单（事件委托）
  _messagesEl.addEventListener('contextmenu', (e) => {
    const msgEl = e.target.closest('[data-msg-idx]')
    if (!msgEl) return
    showMsgContextMenu(e, parseInt(msgEl.dataset.msgIdx))
  })

  // 发送（流式中输入排队，空输入时点按钮停止流式）
  _sendBtn.addEventListener('click', () => {
    if (_isStreaming && !_textarea.value.trim() && _pendingImages.length === 0) { stopStreaming(); return }
    if (_textarea.value.trim() || _pendingImages.length > 0) {
      sendMessage(_textarea.value)
      _textarea.value = ''
      autoResize(_textarea)
    }
  })

  // Enter 发送，Shift+Enter 换行
  _textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!_textarea.value.trim() && _pendingImages.length === 0) return
      sendMessage(_textarea.value)
      _textarea.value = ''
      autoResize(_textarea)
    }
  })

  // 自动高度
  _textarea.addEventListener('input', () => autoResize(_textarea))

  // 图片上传按钮
  const fileInput = page.querySelector('#ast-file-input')
  page.querySelector('#ast-btn-attach').addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => {
    for (const file of fileInput.files) addImageFromFile(file)
    fileInput.value = ''
  })

  // 粘贴图片（Ctrl+V）
  _textarea.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items
    if (!items) return
    let hasImage = false
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        addImageFromClipboard(item)
        hasImage = true
      }
    }
    if (hasImage) e.preventDefault()
  })

  // 拖拽图片
  const mainEl = page.querySelector('.ast-main')
  mainEl.addEventListener('dragover', (e) => {
    e.preventDefault()
    mainEl.classList.add('ast-drag-over')
  })
  mainEl.addEventListener('dragleave', (e) => {
    if (!mainEl.contains(e.relatedTarget)) mainEl.classList.remove('ast-drag-over')
  })
  mainEl.addEventListener('drop', (e) => {
    e.preventDefault()
    mainEl.classList.remove('ast-drag-over')
    for (const file of e.dataTransfer.files) addImageFromFile(file)
  })

  // 图片预览删除
  page.querySelector('#ast-image-preview').addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-img-del]')
    if (delBtn) removeImage(delBtn.dataset.imgDel)
  })

  // 队列事件委托
  _queueEl.addEventListener('click', (e) => {
    // 插队发送
    const sendBtn = e.target.closest('[data-queue-send]')
    if (sendBtn) {
      const id = sendBtn.dataset.queueSend
      const idx = _messageQueue.findIndex(m => m.id === id)
      if (idx === -1) return
      const item = _messageQueue.splice(idx, 1)[0]
      renderQueue()
      if (_isStreaming) stopStreaming()
      setTimeout(() => sendMessageDirect(item.text), 150)
      return
    }
    // 删除
    const delBtn = e.target.closest('[data-queue-del]')
    if (delBtn) {
      const id = delBtn.dataset.queueDel
      _messageQueue = _messageQueue.filter(m => m.id !== id)
      renderQueue()
      return
    }
    // 编辑（点击文字或编辑按钮）
    const editTarget = e.target.closest('[data-queue-edit]') || e.target.closest('[data-queue-edit-btn]')
    if (editTarget) {
      const id = editTarget.dataset.queueEdit || editTarget.dataset.queueEditBtn
      const item = _messageQueue.find(m => m.id === id)
      if (!item) return
      const queueItem = _queueEl.querySelector(`[data-queue-id="${id}"]`)
      if (!queueItem || queueItem.classList.contains('editing')) return
      queueItem.classList.add('editing')
      const textEl = queueItem.querySelector('.ast-queue-text')
      const input = document.createElement('textarea')
      input.className = 'ast-queue-edit-input'
      input.value = item.text
      input.rows = 1
      textEl.replaceWith(input)
      input.focus()
      input.style.height = Math.min(input.scrollHeight, 100) + 'px'
      // 保存编辑
      const save = () => {
        const newText = input.value.trim()
        if (newText) item.text = newText
        renderQueue()
      }
      input.addEventListener('blur', save)
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); save() }
        if (ev.key === 'Escape') renderQueue()
      })
      input.addEventListener('input', () => {
        input.style.height = 'auto'
        input.style.height = Math.min(input.scrollHeight, 100) + 'px'
      })
    }
  })

  // 侧边栏切换
  page.querySelector('#ast-btn-toggle').addEventListener('click', () => {
    page.querySelector('#ast-sidebar').classList.toggle('open')
  })

  // 新建会话
  page.querySelector('#ast-btn-new').addEventListener('click', () => {
    createSession()
    renderSessionList()
    renderMessages()
  })

  // 模式切换
  page.querySelector('#ast-mode-selector').addEventListener('click', (e) => {
    const btn = e.target.closest('.ast-mode-btn')
    if (!btn) return
    const modeKey = btn.dataset.mode
    if (!MODES[modeKey] || modeKey === currentMode()) return
    _config.mode = modeKey
    saveConfig()
    page.querySelectorAll('.ast-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === modeKey))
    applyModeStyle(page, modeKey)
    playModeTransition(page, modeKey)
  })

  // 设置
  page.querySelector('#ast-btn-settings').addEventListener('click', showSettings)

  // 会话列表事件委托
  _sessionListEl.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('[data-delete]')
    if (deleteBtn) {
      e.stopPropagation()
      const id = deleteBtn.dataset.delete
      showConfirm('确定删除这个会话吗？').then(ok => {
        if (!ok) return
        deleteSession(id)
        renderSessionList()
        renderMessages()
      })
      return
    }
    const item = e.target.closest('.ast-session-item')
    if (item) {
      _currentSessionId = item.dataset.id
      renderSessionList()
      renderMessages()
      // 切换到正在流式的会话时，启动刷新
      if (_isStreaming && getSessionStatus(_currentSessionId) === 'streaming') {
        startStreamRefresh()
      } else {
        stopStreamRefresh()
      }
    }
  })

  // 欢迎页技能卡片 & 快捷按钮委托
  _messagesEl.addEventListener('click', (e) => {
    const skillCard = e.target.closest('.ast-skill-card')
    if (skillCard) {
      const skill = BUILTIN_SKILLS.find(s => s.id === skillCard.dataset.skill)
      if (!skill) return

      // 技能需要工具 → 自动切换到执行模式（如果当前是聊天模式）
      if (skill.tools.length > 0 && currentMode() === 'chat') {
        _config.mode = 'execute'
        saveConfig()
        page.querySelectorAll('.ast-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'execute'))
        toast('已自动切换到 🚀 执行模式', 'info')
      }

      sendMessage(skill.prompt)
      return
    }

    const quickBtn = e.target.closest('.ast-quick-btn')
    if (quickBtn) {
      const prompt = quickBtn.dataset.prompt
      if (prompt) sendMessage(prompt)
    }
  })

  return page
}

function autoResize(textarea) {
  textarea.style.height = 'auto'
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px'
}

export function cleanup() {
  flushSave()
  stopStreamRefresh()
  _pendingImages = []
  _page = null
  _messagesEl = null
  _queueEl = null
  _textarea = null
  _sendBtn = null
  _sessionListEl = null
}
