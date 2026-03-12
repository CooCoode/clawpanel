/**
 * 共享模型预设配置
 * models.js 和 assistant.js 共用，只需维护一套数据
 */

// API 接口类型选项
export const API_TYPES = [
  { value: 'openai-completions', label: 'OpenAI 兼容 (最常用)' },
  { value: 'anthropic-messages', label: 'Anthropic 原生' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'google-gemini', label: 'Google Gemini' },
]

// 服务商快捷预设
export const PROVIDER_PRESETS = [
  { key: 'openai', label: 'OpenAI 官方', baseUrl: 'https://api.openai.com/v1', api: 'openai-completions' },
  { key: 'anthropic', label: 'Anthropic 官方', baseUrl: 'https://api.anthropic.com', api: 'anthropic-messages' },
  { key: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', api: 'openai-completions' },
  { key: 'google', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', api: 'google-gemini' },
  { key: 'ollama', label: 'Ollama (本地)', baseUrl: 'http://127.0.0.1:11434/v1', api: 'openai-completions' },
]

// gpt.qt.cool 推广配置
export const QTCOOL = {
  baseUrl: 'https://gpt.qt.cool/v1',
  defaultKey: 'sk-0JDu7hyc51ZKD4iNebpFu07EUEhXmVVc',
  site: 'https://gpt.qt.cool/',
  usageUrl: 'https://gpt.qt.cool/user?key=',
  providerKey: 'qtcool',
  api: 'openai-completions',
  models: []  // 始终从 API 动态获取最新模型列表
}

// 常用模型预设（按服务商分组）
export const MODEL_PRESETS = {
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000 },
    { id: 'o3-mini', name: 'o3 Mini', contextWindow: 200000, reasoning: true },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-5-20250514', name: 'Claude Sonnet 4.5', contextWindow: 200000 },
    { id: 'claude-haiku-3-5-20241022', name: 'Claude Haiku 3.5', contextWindow: 200000 },
  ],
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek V3', contextWindow: 64000 },
    { id: 'deepseek-reasoner', name: 'DeepSeek R1', contextWindow: 64000, reasoning: true },
  ],
  google: [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1000000, reasoning: true },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1000000 },
  ],
  ollama: [
    { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', contextWindow: 32768 },
    { id: 'llama3.2', name: 'Llama 3.2', contextWindow: 8192 },
    { id: 'gemma3', name: 'Gemma 3', contextWindow: 32768 },
  ],
}

/**
 * 动态获取 QTCOOL 模型列表
 * @param {string} [apiKey] - 自定义密钥，不传则用默认密钥
 * @returns {Promise<Array<{id:string, name:string, contextWindow:number, reasoning?:boolean}>>}
 */
export async function fetchQtcoolModels(apiKey) {
  const key = apiKey || QTCOOL.defaultKey
  try {
    const resp = await fetch(QTCOOL.baseUrl + '/models', {
      headers: { 'Authorization': 'Bearer ' + key },
      signal: AbortSignal.timeout(8000)
    })
    if (resp.ok) {
      const data = await resp.json()
      if (data.data && data.data.length) {
        return data.data.map(m => ({
          id: m.id, name: m.id, contextWindow: 128000,
          reasoning: m.id.includes('codex')
        })).sort((a, b) => b.id.localeCompare(a.id))
      }
    }
  } catch { /* use fallback */ }
  return QTCOOL.models
}
