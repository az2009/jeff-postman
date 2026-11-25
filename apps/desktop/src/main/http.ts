import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import tls from 'node:tls'
import net from 'node:net'
import { randomInt, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { Socket } from 'node:net'
import { DEFAULT_SETTINGS, type AppSettings, type HttpResponse, type HttpTimings, type SendInput, type SendResult, type SentRequest } from '@shared/types'
import type { CookieJar } from '@shared/cookies'
import { activeBody, autoContentType, fileName, mimeFromPath, normalizeUrl, RAW_CONTENT_TYPE } from '@shared/http'
import { applySimpleAuth, getBool, getParam } from '@shared/auth'
import { sign, type SignatureMethod } from './oauth1'
import type { PmAuth } from '@shared/types'

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

export interface TlsOptions {
  rejectUnauthorized: boolean
  ca?: (string | Buffer)[]
  cert?: Buffer
  key?: Buffer
  pfx?: Buffer
  passphrase?: string
}

export interface ProxyRoute {
  host: string
  port: number
  authorization?: string
}

interface OnceOptions {
  tls: TlsOptions
  proxy: ProxyRoute | null
  maxBody: number
}

function once(url: URL, method: string, headers: [string, string][], data: Buffer | null, signal: AbortSignal, o: OnceOptions): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:'
    const t0 = performance.now()
    const t: Record<string, number> = {}
    let reused = false
    let remoteAddress: string | null = null
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const port = Number(url.port || (isHttps ? 443 : 80))

    let options: https.RequestOptions
    if (o.proxy && !isHttps) {
      // HTTP pelo proxy: pede a URL absoluta ao proxy
      const h = [...headers]
      if (o.proxy.authorization) h.push(['Proxy-Authorization', o.proxy.authorization])
      options = { host: o.proxy.host, port: o.proxy.port, path: url.href, method, headers: h as unknown as http.OutgoingHttpHeaders, agent: agents.http, signal }
    } else if (o.proxy && isHttps) {
      // HTTPS pelo proxy: túnel CONNECT e TLS por dentro dele
      const proxy = o.proxy
      options = {
        host: hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: headers as unknown as http.OutgoingHttpHeaders,
        // sem agent: com agent (mesmo agent:false) o Node ignora o createConnection
        signal,
        createConnection: ((_opts: unknown, cb: (err: Error | null, sock?: Socket) => void) => {
          const connectHeaders: Record<string, string> = { Host: `${hostname}:${port}` }
          if (proxy.authorization) connectHeaders['Proxy-Authorization'] = proxy.authorization
          // o signal também derruba o CONNECT: Cancel e timeout não podem esperar o proxy responder
          const creq = http.request({ host: proxy.host, port: proxy.port, method: 'CONNECT', path: `${hostname}:${port}`, headers: connectHeaders, signal })
          creq.on('connect', (res, socket) => {
            if (res.statusCode !== 200) {
              socket.destroy()
              cb(Object.assign(new Error(`O proxy recusou o túnel para ${hostname}:${port} (${res.statusCode} ${res.statusMessage ?? ''})`), { code: 'EPROXY' }))
              return
            }
            t.connect = performance.now()
            const sock = tls.connect({ socket, servername: net.isIP(hostname) ? undefined : hostname, ...o.tls })
            sock.once('secureConnect', () => (t.secure = performance.now()))
            cb(null, sock)
          })
          creq.on('error', (e) => cb(Object.assign(e, { message: `Falha no proxy ${proxy.host}:${proxy.port}: ${e.message}` })))
          creq.end()
          return undefined
        }) as unknown as https.RequestOptions['createConnection']
      }
    } else {
      options = {
        protocol: url.protocol,
        hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers: headers as unknown as http.OutgoingHttpHeaders,
        agent: isHttps ? agents.https : agents.http,
        signal,
        ...(isHttps ? o.tls : {})
      }
    }

    const req = (isHttps ? https : http).request(options, (res) => {
      t.firstByte = performance.now()
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (c: Buffer) => {
        size += c.length
        if (size > o.maxBody) {
          req.destroy(Object.assign(new Error(`Resposta maior que ${Math.round(o.maxBody / 1024 / 1024)} MB (ajuste em Settings)`), { code: 'ETOOBIG' }))
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
    })

    req.on('socket', (sock: Socket) => {
      t.socket ??= performance.now()
      const capture = () => (remoteAddress = sock.remoteAddress ?? null)
      if (sock.connecting) {
        sock.once('lookup', () => (t.lookup = performance.now()))
        sock.once('connect', () => ((t.connect = performance.now()), capture()))
        sock.once('secureConnect', () => (t.secure = performance.now()))
      } else if (!o.proxy) {
        reused = true
        capture()
      } else capture()
    })
    req.on('error', reject)
    req.end(data ?? undefined)
  })
}

/**
 * Descompacta o corpo. O limite de tamanho vale também para o corpo descompactado: sem ele, uma
 * resposta pequena (zip bomb) podia virar gigabytes na memória e derrubar o app.
 */
export function decode(body: Buffer, encoding: string | undefined, maxOutput = Infinity): Buffer {
  const enc = (encoding ?? '').toLowerCase().trim()
  const opts = Number.isFinite(maxOutput) ? { maxOutputLength: Math.max(1, Math.floor(maxOutput)) } : {}
  const tooBig = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ERR_BUFFER_TOO_LARGE' || /Cannot create a Buffer larger than/i.test(String((e as Error)?.message))
  const fail = () =>
    Object.assign(new Error(`Resposta descompactada maior que ${Math.round(maxOutput / 1024 / 1024)} MB (ajuste em Settings)`), { code: 'ETOOBIG' })
  try {
    if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzipSync(body, { finishFlush: zlib.constants.Z_SYNC_FLUSH, ...opts })
    if (enc === 'br') return zlib.brotliDecompressSync(body, opts)
    if (enc === 'deflate') {
      try {
        return zlib.inflateSync(body, opts)
      } catch (e) {
        if (tooBig(e)) throw e
        return zlib.inflateRawSync(body, opts)
      }
    }
  } catch (e) {
    if (tooBig(e)) throw fail()
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

/** Opções do envio que vêm das configurações e da requisição (protocolProfileBehavior do Postman). */
export interface SendOptions {
  settings?: AppSettings
  cookieJar?: CookieJar | null
}

function behavior(input: SendInput, st: AppSettings) {
  const ppb = (input.doc.protocolProfileBehavior ?? {}) as Record<string, unknown>
  const bool = (k: string, d: boolean) => (typeof ppb[k] === 'boolean' ? (ppb[k] as boolean) : d)
  const num = (k: string, d: number) => (typeof ppb[k] === 'number' && Number.isFinite(ppb[k]) ? (ppb[k] as number) : d)
  return {
    followRedirects: bool('followRedirects', st.followRedirects),
    followOriginalHttpMethod: bool('followOriginalHttpMethod', false),
    maxRedirects: Math.max(0, num('maxRedirects', st.maxRedirects)),
    strictSSL: bool('strictSSL', st.sslVerification),
    disableCookies: bool('disableCookies', !st.sendCookies)
  }
}

const fileCache = new Map<string, Buffer>()
function readCached(path: string): Buffer {
  let b = fileCache.get(path)
  if (!b) {
    b = readFileSync(path)
    fileCache.set(path, b)
  }
  return b
}
export function clearCertCache(): void {
  fileCache.clear()
}

function hostMatches(pattern: string, url: URL): boolean {
  const [h, p] = pattern.trim().toLowerCase().split(':')
  if (!h) return false
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  if (p && p !== port) return false
  const host = url.hostname.toLowerCase()
  return h.startsWith('*.') ? host === h.slice(2) || host.endsWith(h.slice(1)) : host === h
}

function tlsFor(url: URL, st: AppSettings, strict: boolean): TlsOptions {
  const o: TlsOptions = { rejectUnauthorized: strict }
  if (st.ca.enabled && st.ca.path) o.ca = [...tls.rootCertificates, readCached(st.ca.path)]
  const cert = st.clientCerts.find((c) => hostMatches(c.host, url))
  if (cert) {
    if (cert.pfxPath) o.pfx = readCached(cert.pfxPath)
    if (cert.crtPath) o.cert = readCached(cert.crtPath)
    if (cert.keyPath) o.key = readCached(cert.keyPath)
    if (cert.passphrase) o.passphrase = cert.passphrase
  }
  return o
}

function proxyFor(url: URL, st: AppSettings): ProxyRoute | null {
  const p = st.proxy
  if (!p.enabled || !p.host) return null
  const host = url.hostname.toLowerCase()
  const bypass = p.bypass
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
  if (bypass.some((b) => (b.startsWith('*.') ? host.endsWith(b.slice(1)) : b.startsWith('.') ? host.endsWith(b) : host === b))) return null
  return {
    host: p.host,
    port: p.port || 8080,
    authorization: p.auth ? 'Basic ' + Buffer.from(`${p.username}:${p.password}`).toString('base64') : undefined
  }
}

/** Header Cookie do jar, a menos que o usuário tenha posto o dele. */
function withCookies(headers: [string, string][], jar: CookieJar | null, url: URL): [string, string][] {
  if (!jar || headers.some(([k]) => k.toLowerCase() === 'cookie')) return headers
  const c = jar.header(url)
  return c ? [...headers, ['Cookie', c]] : headers
}

export async function send(input: SendInput, appVersion: string, opts: SendOptions = {}): Promise<SendResult> {
  const { requestId } = input
  const st = opts.settings ?? DEFAULT_SETTINGS
  const bh = behavior(input, st)
  const jar = bh.disableCookies ? null : (opts.cookieJar ?? null)
  const controller = new AbortController()
  inflight.set(requestId, controller)
  let timedOut = false
  const timer =
    st.requestTimeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          controller.abort()
        }, st.requestTimeoutMs)
      : null
  let sent: SentRequest | null = null
  try {
    let url = new URL(normalizeUrl(input.doc.request.url.raw))
    let method = input.doc.request.method
    let built = await buildBody(input)
    const applied = applyAuth(input.auth, method, url, built)
    url = applied.url
    built = applied.built
    const authHeaders = applied.headers
    let headers = withCookies(buildHeaders(input, built, appVersion, url.host, authHeaders), jar, url)
    sent = { method, url: url.toString(), headers, bodySize: built.data?.length ?? 0, bodyPreview: preview(built) }
    const onceOpts = (u: URL): OnceOptions => ({ tls: tlsFor(u, st, bh.strictSSL), proxy: proxyFor(u, st), maxBody: st.maxResponseMb * 1024 * 1024 })

    let redirects = 0
    let raw = await once(url, method, headers, built.data, controller.signal, onceOpts(url))
    jar?.store(url, setCookies(raw.rawHeaders))
    const firstTimings = raw.timings
    let totalMs = raw.timings.total

    while (bh.followRedirects && [301, 302, 303, 307, 308].includes(raw.status) && redirects < bh.maxRedirects) {
      const location = headerValue(raw.rawHeaders, 'location')
      if (!location) break
      const next = new URL(location, url)
      // 303 sempre vira GET; 301/302 com POST também, a menos que "seguir o método original" esteja ligado
      if (raw.status === 303 || (!bh.followOriginalHttpMethod && (raw.status === 301 || raw.status === 302) && method === 'POST')) {
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
      headers = withCookies(headers, jar, url)
      sent = { method, url: url.toString(), headers, bodySize: built.data?.length ?? 0, bodyPreview: preview(built) }
      raw = await once(url, method, headers, built.data, controller.signal, onceOpts(url))
      jar?.store(url, setCookies(raw.rawHeaders))
      totalMs += raw.timings.total
      redirects++
    }

    const statusLine = `HTTP/${raw.httpVersion} ${raw.status} ${raw.statusText}\r\n`
    const headersSize =
      statusLine.length + pairs(raw.rawHeaders).reduce((n, [k, v]) => n + k.length + v.length + 4, 0) + 2
    const decoded = decode(raw.body, headerValue(raw.rawHeaders, 'content-encoding'), st.maxResponseMb * 1024 * 1024)

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
    const e = err as NodeJS.ErrnoException & { port?: number }
    const cancelled = controller.signal.aborted && !timedOut
    let viaProxy: ProxyRoute | null = null
    try {
      viaProxy = proxyFor(new URL(normalizeUrl(sent?.url ?? input.doc.request.url.raw)), st)
    } catch {
      // URL inválida
    }
    if (viaProxy && !cancelled && !timedOut && ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EHOSTUNREACH'].includes(e.code ?? '') && (e.port === viaProxy.port || e.code === 'ENOTFOUND')) {
      return {
        ok: false,
        requestId,
        cancelled: false,
        code: e.code ?? null,
        error: `Proxy ${viaProxy.host}:${viaProxy.port} inacessível (${e.code}). Confira o proxy em Settings → Proxy`,
        request: sent
      }
    }
    return {
      ok: false,
      requestId,
      cancelled,
      code: timedOut ? 'ETIMEDOUT' : (e.code ?? null),
      error: timedOut
        ? `Request timed out: sem resposta em ${st.requestTimeoutMs} ms (ajuste o timeout em Settings)`
        : cancelled
          ? 'Request cancelled'
          : describe(e, sent?.url ?? input.doc.request.url.raw),
      request: sent
    }
  } finally {
    if (timer) clearTimeout(timer)
    inflight.delete(requestId)
  }
}

function setCookies(raw: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < raw.length; i += 2) if (raw[i].toLowerCase() === 'set-cookie') out.push(raw[i + 1])
  return out
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
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
    case 'CERT_HAS_EXPIRED':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return `SSL Error: ${e.code} (${host}). Desligue "SSL certificate verification" em Settings (ou na aba Settings da requisição) ou adicione o certificado da CA`
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

/** Corpo enviado como texto para o console (binário vira um resumo). */
function preview(b: BuiltBody): string | undefined {
  if (!b.data || b.data.length === 0) return undefined
  const ct = (b.contentType ?? '').toLowerCase()
  const textual = !ct || /json|xml|text|javascript|x-www-form-urlencoded|multipart\/form-data|html|csv/.test(ct)
  if (!textual) return `<${b.data.length} bytes, ${ct}>`
  const max = 64 * 1024
  const t = b.data.subarray(0, max).toString('utf8')
  return b.data.length > max ? `${t}\n… (${b.data.length - max} bytes a mais)` : t
}
