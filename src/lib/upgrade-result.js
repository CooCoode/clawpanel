function asText(result) {
  if (typeof result === 'string') return result
  if (result && typeof result === 'object') {
    if (typeof result.message === 'string') return result.message
    if (typeof result.result === 'string') return result.result
  }
  return ''
}

function pickDoneMessage(lines, fallback) {
  if (!lines.length) return fallback

  const preferred = [...lines].reverse().find((line) => {
    if (line.startsWith('✅')) return true
    if (/(安装|升级|降级|切换|回退|卸载).*(完成|成功)/.test(line)) return true
    return /(完成|成功)/.test(line)
  })

  return preferred || lines[lines.length - 1] || fallback
}

export function parseUpgradeResultForModal(result, fallback = '操作完成') {
  const lines = asText(result)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  return {
    logLines: lines,
    doneMessage: pickDoneMessage(lines, fallback),
  }
}
