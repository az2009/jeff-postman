import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { randomInt, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { Socket } from 'node:net'
import type { HttpResponse, HttpTimings, SendInput, SendResult, SentRequest } from '@shared/types'
import { activeBody, autoContentType, fileName, mimeFromPath, normalizeUrl, RAW_CONTENT_TYPE } from '@shared/http'
import { applySimpleAuth, getBool, getParam } from '@shared/auth'
import { sign, type SignatureMethod } from './oauth1'
import type { PmAuth } from '@shared/types'

const MAX_REDIRECTS = 10
const MAX_BODY = 200 * 1024 * 1024

const agents = {
  http: new http.Agent({ keepAlive: true }),
  https: new https.Agent({ keepAlive: true })
}

const inflight = new Map<string, AbortController>()

export function cancel(requestId: string): void {
  inflight.get(requestId)?.abort()
}

interface BuiltBody {
  data: Buffer | null
  contentType: string | null
}

async function buildBody(input: SendInput): Promise<BuiltBody> {
  const body = activeBody(input.doc.request.body)
  if (!body) return { data: null, contentType: null }
  switch (body.mode) {
    case 'raw':
      return {
        data: Buffer.from(body.raw ?? '', 'utf8'),
        contentType: RAW_CONTENT_TYPE[body.options?.raw?.language ?? 'text']
      }
    case 'urlencoded': {
      const params = new URLSearchParams()
      for (const p of body.urlencoded ?? []) if (!p.disabled && p.key) params.append(p.key, p.value)
      return { data: Buffer.from(params.toString(), 'utf8'), contentType: 'application/x-www-form-urlencoded' }
    }
    case 'formdata': {
      let digits = ''
      for (let i = 0; i < 24; i++) digits += randomInt(10)
      const boundary = `--------------------------${digits}`
      const parts: Buffer[] = []
      for (const e of body.formdata ?? []) {
        if (e.disabled || !e.key) continue
        if (e.type === 'file') {
          const srcs = Array.isArray(e.src) ? e.src : e.src ? [e.src] : []
          for (const src of srcs) {
            const content = await readFile(src)
            const ct = e.contentType || mimeFromPath(src)
            parts.push(
              Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="${escapeQuotes(e.key)}"; filename="${escapeQuotes(fileName(src))}"\r\nContent-Type: ${ct}\r\n\r\n`
              ),
              content,
              Buffer.from('\r\n')
            )
          }
        } else {
          const ctLine = e.contentType ? `Content-Type: ${e.contentType}\r\n` : ''
          parts.push(
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${escapeQuotes(e.key)}"\r\n${ctLine}\r\n${e.value ?? ''}\r\n`)
          )
        }
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`))
      return { data: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
    }
    case 'file': {
      if (!body.file?.src) return { data: null, contentType: null }
      return { data: await readFile(body.file.src), contentType: autoContentType(body) }
    }
    default:
      return { data: null, contentType: null }
  }
}

const escapeQuotes = (s: string) => s.replace(/"/g, '%22').replace(/\r|\n/g, ' ')

/** Monta a lista final de headers: os do usuário vencem os automáticos (comparação sem caixa). */
function buildHeaders(input: SendInput, built: BuiltBody, appVersion: string, host: string, authHeaders: [string, string][] = []): [string, string][] {
  const user = input.doc.request.header.filter((h) => !h.disabled && h.key.trim())
  const has = new Set(user.map((h) => h.key.trim().toLowerCase()))
  const out: [string, string][] = []
  const auto = (k: string, v: string | null) => {
    if (v !== null && !has.has(k.toLowerCase())) out.push([k, v])
  }
  auto('Content-Type', built.contentType)
  for (const [k, v] of authHeaders) auto(k, v)
  for (const h of user) out.push([h.key.trim(), h.value])
  auto('JeffPostman-Token', randomUUID())
  auto('Host', host)
  auto('User-Agent', `JeffPostmanRuntime/${appVersion}`)
  auto('Accept', '*/*')
  auto('Accept-Encoding', 'gzip, deflate, br')
  auto('Connection', 'keep-alive')
  if (built.data) auto('Content-Length', String(built.data.length))
  return out
}

interface RawResult {
  status: number
  statusText: string
  httpVersion: string
  rawHeaders: string[]
  body: Buffer
  timings: HttpTimings
  remoteAddress: string | null
  reused: boolean
}

function once(url: URL, method: string, headers: [string, string][], data: Buffer | null, signal: AbortSignal): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:'
    const t0 = performance.now()
    const t: Record<string, number> = {}
    let reused = false
    let remoteAddress: string | null = null

    const req = (isHttps ? https : http).request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers: headers as unknown as http.OutgoingHttpHeaders,
        agent: isHttps ? agents.https : agents.http,
        rejectUnauthorized: true,
        signal
      },
      (res) => {
        t.firstByte = performance.now()
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > MAX_BODY) {
            req.destroy(new Error(`Resposta maior que ${MAX_BODY / 1024 / 1024} MB`))
            return
          }
          chunks.push(c)
        })
        res.on('error', reject)
        res.on('end', () => {
          t.end = performance.now()
          const start = t.socket ?? t0
          const afterDns = t.lookup ?? start
          const afterTcp = t.connect ?? afterDns
          const afterTls = t.secure ?? afterTcp
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            httpVersion: res.httpVersion,
            rawHeaders: res.rawHeaders,
            body: Buffer.concat(chunks),
            remoteAddress,
            reused,
            timings: {
              dns: t.lookup ? t.lookup - start : 0,
              tcp: t.connect ? t.connect - afterDns : 0,
              tls: t.secure ? t.secure - afterTcp : 0,
              ttfb: t.firstByte - (reused ? t0 : afterTls),
              download: t.end - t.firstByte,
              total: t.end - t0
            }
          })
        })
      }
    )

    req.on('socket', (s: Socket) => {
      t.socket = performance.now()
      const capture = () => (remoteAddress = s.remoteAddress ?? null)
      if (s.connecting) {
        s.once('lookup', () => (t.lookup = performance.now()))
        s.once('connect', () => ((t.connect = performance.now()), capture()))
        s.once('secureConnect', () => (t.secure = performance.now()))
      } else {
        reused = true
        capture()
      }
    })
    req.on('error', reject)
    req.end(data ?? undefined)
  })
}

function decode(body: Buffer, encoding: string | undefined): Buffer {
  const enc = (encoding ?? '').toLowerCase().trim()
  try {
    if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzipSync(body, { finishFlush: zlib.constants.Z_SYNC_FLUSH })
    if (enc === 'br') return zlib.brotliDecompressSync(body)
    if (enc === 'deflate') {
      try {
        return zlib.inflateSync(body)
      } catch {
        return zlib.inflateRawSync(body)
      }
    }
  } catch {
    // corpo inválido para o encoding: devolve como veio
  }
  return body
}

function headerValue(raw: string[], name: string): string | undefined {
  for (let i = 0; i < raw.length; i += 2) if (raw[i].toLowerCase() === name) return raw[i + 1]
  return undefined
}

function pairs(raw: string[]): [string, string][] {
  const out: [string, string][] = []
  for (let i = 0; i < raw.length; i += 2) out.push([raw[i], raw[i + 1]])
  return out
}

export async function send(input: SendInput, appVersion: string): Promise<SendResult> {
  const { requestId } = input
  const controller = new AbortController()
  inflight.set(requestId, controller)
  let sent: SentRequest | null = null
  try {
    let url = new URL(normalizeUrl(input.doc.request.url.raw))
    let method = input.doc.request.method
    let built = await buildBody(input)
    const applied = applyAuth(input.auth, method, url, built)
    url = applied.url
    built = applied.built
    const authHeaders = applied.headers
    let headers = buildHeaders(input, built, appVersion, url.host, authHeaders)
    sent = { method, url: url.toString(), headers, bodySize: built.data?.length ?? 0 }

    let redirects = 0
    let raw = await once(url, method, headers, built.data, controller.signal)
    const firstTimings = raw.timings
    let totalMs = raw.timings.total

    while ([301, 302, 303, 307, 308].includes(raw.status) && redirects < MAX_REDIRECTS) {
      const location = headerValue(raw.rawHeaders, 'location')
      if (!location) break
      const next = new URL(location, url)
      // 303 sempre vira GET; 301/302 com POST também (comportamento padrão do Postman e navegadores)
      if (raw.status === 303 || ((raw.status === 301 || raw.status === 302) && method === 'POST')) {
        method = 'GET'
        built = { data: null, contentType: null }
      }
      const crossOrigin = next.host !== url.host
      url = next
      headers = buildHeaders(input, built, appVersion, url.host, crossOrigin ? [] : authHeaders).filter(([k]) => {
        const l = k.toLowerCase()
        if (!built.data && (l === 'content-type' || l === 'content-length')) return false
        if (crossOrigin && (l === 'authorization' || l === 'cookie')) return false
        return true
      })
      sent = { method, url: url.toString(), headers, bodySize: built.data?.length ?? 0 }
      raw = await once(url, method, headers, built.data, controller.signal)
      totalMs += raw.timings.total
      redirects++
    }

    const statusLine = `HTTP/${raw.httpVersion} ${raw.status} ${raw.statusText}\r\n`
    const headersSize =
      statusLine.length + pairs(raw.rawHeaders).reduce((n, [k, v]) => n + k.length + v.length + 4, 0) + 2
    const decoded = decode(raw.body, headerValue(raw.rawHeaders, 'content-encoding'))

    const response: HttpResponse = {
      requestId,
      status: raw.status,
      statusText: raw.statusText,
      httpVersion: raw.httpVersion,
      headers: pairs(raw.rawHeaders),
      body: new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength),
      bodySize: raw.body.length,
      headersSize,
      timings: redirects ? { ...firstTimings, total: totalMs } : raw.timings,
      url: url.toString(),
      redirects,
      remoteAddress: raw.remoteAddress,
      reusedConnection: raw.reused,
      request: sent
    }
    return { ok: true, response }
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    const cancelled = controller.signal.aborted
    return {
      ok: false,
      requestId,
      cancelled,
      code: e.code ?? null,
      error: cancelled ? 'Request cancelled' : describe(e, sent?.url ?? input.doc.request.url.raw),
      request: sent
    }
  } finally {
    inflight.delete(requestId)
  }
}

function describe(e: NodeJS.ErrnoException, target: string): string {
  let host = target
  try {
    host = new URL(normalizeUrl(target)).host
  } catch {
    // URL inválida: usa o texto
  }
  switch (e.code) {
    case 'ENOTFOUND':
      return `Could not resolve host: ${(e as { hostname?: string }).hostname ?? host}`
    case 'ECONNREFUSED':
      return `Connection refused: ${host}`
    case 'ECONNRESET':
      return 'Connection reset by server'
    case 'ETIMEDOUT':
      return `Connection timed out: ${host}`
    case 'ERR_INVALID_URL':
      return 'Invalid URL'
    case 'ENOENT':
      return `File not found: ${(e as { path?: string }).path ?? ''}`
    default:
      return e.message || String(e)
  }
}

/**
 * Aplica o auth efetivo: Basic/Bearer/API Key/OAuth 2.0 viram header ou query; OAuth 1.0 assina
 * o método, a URL final e o corpo (form entra na assinatura; outros corpos podem levar body hash).
 */
function applyAuth(auth: PmAuth | undefined, method: string, url: URL, built: BuiltBody): { url: URL; built: BuiltBody; headers: [string, string][] } {
  const out = { url, built, headers: [] as [string, string][] }
  if (!auth || auth.type === 'noauth') return out
  if (auth.type === 'oauth1') {
    const isForm = (built.contentType ?? '').startsWith('application/x-www-form-urlencoded')
    const formBody = isForm && built.data ? built.data.toString('utf8') : null
    const r = sign(
      {
        consumerKey: getParam(auth, 'consumerKey'),
        consumerSecret: getParam(auth, 'consumerSecret'),
        token: getParam(auth, 'token'),
        tokenSecret: getParam(auth, 'tokenSecret'),
        signatureMethod: (getParam(auth, 'signatureMethod', 'HMAC-SHA1') || 'HMAC-SHA1') as SignatureMethod,
        timestamp: getParam(auth, 'timestamp'),
        nonce: getParam(auth, 'nonce'),
        version: getParam(auth, 'version', '1.0'),
        realm: getParam(auth, 'realm'),
        callback: getParam(auth, 'callback'),
        verifier: getParam(auth, 'verifier'),
        privateKey: getParam(auth, 'privateKey'),
        includeBodyHash: getBool(auth, 'includeBodyHash'),
        addEmptyParamsToSign: getBool(auth, 'addEmptyParamsToSign')
      },
      { method, url, formBody, rawBody: isForm ? null : built.data }
    )
    if (getBool(auth, 'addParamsToHeader', true)) {
      out.headers.push(['Authorization', r.header])
    } else if (isForm || (!built.data && method !== 'GET' && method !== 'HEAD')) {
      // parâmetros no corpo do formulário
      const extra = new URLSearchParams(r.oauthParams).toString()
      const data = Buffer.from(formBody ? `${formBody}&${extra}` : extra, 'utf8')
      out.built = { data, contentType: 'application/x-www-form-urlencoded' }
    } else {
      const u = new URL(url.toString())
      for (const [k, v] of r.oauthParams) u.searchParams.append(k, v)
      out.url = u
    }
    return out
  }
  const simple = applySimpleAuth(auth)
  if (!simple) return out
  out.headers = simple.headers
  if (simple.query.length) {
    const u = new URL(url.toString())
    for (const [k, v] of simple.query) u.searchParams.append(k, v)
    out.url = u
  }
  return out
}
