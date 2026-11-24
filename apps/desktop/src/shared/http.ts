import type { KeyValue, RawLanguage, RequestBody, RequestDoc } from './types'

export const RAW_CONTENT_TYPE: Record<RawLanguage, string> = {
  text: 'text/plain',
  javascript: 'application/javascript',
  json: 'application/json',
  html: 'text/html',
  xml: 'application/xml'
}

const MIME_BY_EXT: Record<string, string> = {
  json: 'application/json',
  xml: 'application/xml',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  js: 'application/javascript',
  css: 'text/css',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip'
}

export function mimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** Corpo efetivo: null quando não há nada a enviar. */
export function activeBody(body: RequestBody | undefined): RequestBody | null {
  if (!body || body.disabled || body.mode === 'none') return null
  return body
}

/** Content-Type que o app põe sozinho para o corpo (o multipart ganha o boundary no envio). */
export function autoContentType(body: RequestBody | undefined): string | null {
  const b = activeBody(body)
  if (!b) return null
  switch (b.mode) {
    case 'raw':
      return RAW_CONTENT_TYPE[b.options?.raw?.language ?? 'text']
    case 'urlencoded':
      return 'application/x-www-form-urlencoded'
    case 'formdata':
      return 'multipart/form-data'
    case 'file':
      return b.file?.src ? mimeFromPath(b.file.src) : null
    default:
      return null
  }
}

export const CALCULATED = '<calculated when request is sent>'

/**
 * Headers automáticos (os "hidden headers" do Postman), na ordem em que vão.
 * O usuário vence: header com o mesmo nome definido por ele substitui o automático.
 */
export function autoHeaders(doc: RequestDoc, version: string): KeyValue[] {
  const ct = autoContentType(doc.request.body)
  const list: KeyValue[] = []
  if (ct) list.push({ key: 'Content-Type', value: ct === 'multipart/form-data' ? `${ct}; boundary=${CALCULATED}` : ct })
  if (activeBody(doc.request.body)) list.push({ key: 'Content-Length', value: CALCULATED })
  list.push(
    { key: 'JeffPostman-Token', value: CALCULATED },
    { key: 'Host', value: CALCULATED },
    { key: 'User-Agent', value: `JeffPostmanRuntime/${version}` },
    { key: 'Accept', value: '*/*' },
    { key: 'Accept-Encoding', value: 'gzip, deflate, br' },
    { key: 'Connection', value: 'keep-alive' }
  )
  return list
}

export function userOverrides(headers: KeyValue[]): Set<string> {
  return new Set(headers.filter((h) => !h.disabled && h.key.trim()).map((h) => h.key.trim().toLowerCase()))
}

/** Postman aceita URL sem protocolo e assume http://. */
export function normalizeUrl(raw: string): string {
  const t = raw.trim()
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `http://${t}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}
