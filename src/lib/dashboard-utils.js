export function normalizeVersionInfo(value) {
  if (value && typeof value === 'object') return value
  return {}
}
