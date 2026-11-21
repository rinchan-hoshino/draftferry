import type { PlatformId } from './types.ts'

const SAFE_QUERY_KEYS = new Set(['t', 'action', 'type', 'productType', 'commodityId'])

export function sanitizeUrl(rawUrl: string): string {
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

export interface DiagnosticInput {
  version: string
  pageUrl: string
  platformId?: PlatformId | null
  editorFound?: boolean
  titleFound?: boolean
  stage?: string | null
  error?: unknown
}

export function buildDiagnostic({
  version,
  pageUrl,
  platformId,
  editorFound,
  titleFound,
  stage = null,
  error = null,
}: DiagnosticInput): string {
  const errObj = error instanceof Error ? error : null
  const errPayload = error
    ? { message: errObj?.message || String(error), stack: errObj?.stack ?? null }
    : null
  return JSON.stringify(
    {
      scriptVersion: version,
      pageUrl: sanitizeUrl(pageUrl),
      platformId: platformId ?? null,
      editorFound: Boolean(editorFound),
      titleFound: Boolean(titleFound),
      stage,
      error: errPayload,
    },
    null,
    2,
  )
}
