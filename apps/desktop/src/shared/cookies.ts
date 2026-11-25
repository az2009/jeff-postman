/** Cookie jar simples (RFC 6265): guarda o Set-Cookie das respostas e devolve o Cookie das próximas requisições. */

export interface Cookie {
  name: string
  value: string
  domain: string
  path: string
  /** epoch ms; null = cookie de sessão */
  expires: number | null
  secure: boolean
  httpOnly: boolean
  /** true quando veio sem Domain: só vale para o host exato */
  hostOnly: boolean
  sameSite?: string
  createdAt: number
}

const defaultPath = (url: URL) => {
  const p = url.pathname
  if (!p.startsWith('/') || p.lastIndexOf('/') === 0) return '/'
  return p.slice(0, p.lastIndexOf('/'))
}

/** Lê um header Set-Cookie. Devolve null quando o domínio não é aceito para esta URL. */
export function parseSetCookie(header: string, url: URL, now = Date.now()): Cookie | null {
  const [pair, ...attrs] = header.split(';')
  const eq = pair.indexOf('=')
  if (eq < 1) return null
  const host = url.hostname.toLowerCase()
  const c: Cookie = {
    name: pair.slice(0, eq).trim(),
    // as aspas fazem parte do valor (RFC 6265, 4.1.1) e voltam como vieram, igual aos navegadores
    value: pair.slice(eq + 1).trim(),
    domain: host,
    path: defaultPath(url),
    expires: null,
    secure: false,
    httpOnly: false,
    hostOnly: true,
    createdAt: now
  }
  let maxAge: number | null = null
  for (const a of attrs) {
    const i = a.indexOf('=')
    const k = (i < 0 ? a : a.slice(0, i)).trim().toLowerCase()
    const v = i < 0 ? '' : a.slice(i + 1).trim()
    switch (k) {
      case 'domain': {
        const d = v.replace(/^\./, '').toLowerCase()
        if (!d) break
        // o servidor só pode pôr cookie no próprio domínio ou num domínio pai
        if (host !== d && !host.endsWith('.' + d)) return null
        c.domain = d
        c.hostOnly = false
        break
      }
      case 'path':
        if (v.startsWith('/')) c.path = v
        break
      case 'expires': {
        const t = Date.parse(v)
        if (!Number.isNaN(t)) c.expires = t
        break
      }
      case 'max-age': {
        const n = Number(v)
        if (Number.isFinite(n)) maxAge = n
        break
      }
      case 'secure':
        c.secure = true
        break
      case 'httponly':
        c.httpOnly = true
        break
      case 'samesite':
        c.sameSite = v
        break
    }
  }
  if (maxAge !== null) c.expires = maxAge <= 0 ? 0 : now + maxAge * 1000
  return c
}

export function domainMatches(c: Cookie, host: string): boolean {
  const h = host.toLowerCase()
  return c.hostOnly ? h === c.domain : h === c.domain || h.endsWith('.' + c.domain)
}

export function pathMatches(cookiePath: string, reqPath: string): boolean {
  if (reqPath === cookiePath) return true
  if (!reqPath.startsWith(cookiePath)) return false
  return cookiePath.endsWith('/') || reqPath[cookiePath.length] === '/'
}

export const isExpired = (c: Cookie, now = Date.now()) => c.expires !== null && c.expires <= now

export const cookieKey = (c: { domain: string; path: string; name: string }) => `${c.domain}\t${c.path}\t${c.name}`

export class CookieJar {
  cookies: Cookie[]
  dirty = false
  /**
   * O que este jar mudou (chave → cookie novo, ou null = apagado). Gravar só as mudanças, e não o jar
   * inteiro, evita que dois envios ao mesmo tempo apaguem os cookies um do outro.
   */
  changes = new Map<string, Cookie | null>()
  constructor(cookies: Cookie[] = []) {
    this.cookies = cookies
  }

  /** Guarda os Set-Cookie de uma resposta; cookie vencido (Max-Age=0, Expires no passado) apaga o existente. */
  store(url: URL, setCookies: string[], now = Date.now()): void {
    for (const h of setCookies) {
      const c = parseSetCookie(h, url, now)
      if (!c) continue
      const i = this.cookies.findIndex((x) => x.name === c.name && x.domain === c.domain && x.path === c.path)
      if (isExpired(c, now)) {
        if (i >= 0) this.cookies.splice(i, 1)
        this.changes.set(cookieKey(c), null)
      } else {
        const next = i >= 0 ? { ...c, createdAt: this.cookies[i].createdAt } : c
        if (i >= 0) this.cookies[i] = next
        else this.cookies.push(next)
        this.changes.set(cookieKey(c), next)
      }
      this.dirty = true
    }
  }

  /** Cookies que vão nesta URL, do caminho mais específico para o mais geral (ordem da RFC). */
  match(url: URL, now = Date.now()): Cookie[] {
    const expired = this.cookies.filter((c) => isExpired(c, now))
    if (expired.length) {
      this.cookies = this.cookies.filter((c) => !isExpired(c, now))
      for (const c of expired) this.changes.set(cookieKey(c), null)
      this.dirty = true
    }
    const secure = url.protocol === 'https:'
    return this.cookies
      .filter((c) => domainMatches(c, url.hostname) && pathMatches(c.path, url.pathname || '/') && (!c.secure || secure))
      .sort((a, b) => b.path.length - a.path.length || a.createdAt - b.createdAt)
  }

  header(url: URL, now = Date.now()): string | null {
    const m = this.match(url, now)
    return m.length ? m.map((c) => `${c.name}=${c.value}`).join('; ') : null
  }
}
