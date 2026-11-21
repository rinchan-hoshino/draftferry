const SAFE_QUERY_KEYS = new Set(['t', 'action', 'type', 'productType', 'commodityId'])

export function sanitizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    const kept = new URLSearchParams()
    for (const [key, value] of url.searchParams) {
      if (SAFE_QUERY_KEYS.has(key)) kept.set(key, value)
    }
    const query = kept.toString()
    return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`
  } catch {
    return ''
  }
}

export function buildDiagnostic({ version, pageUrl, platformId, editorFound, titleFound, stage = null, error = null }) {
  return JSON.stringify({
    scriptVersion: version,
    pageUrl: sanitizeUrl(pageUrl),
    platformId: platformId ?? null,
    editorFound: Boolean(editorFound),
    titleFound: Boolean(titleFound),
    stage,
    error: error ? { message: error.message || String(error), stack: error.stack ?? null } : null,
  }, null, 2)
}
