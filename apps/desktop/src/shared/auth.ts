/**
 * Auth no formato do Postman v2.1: { type, [type]: [{ key, value, type }] }.
 * Requisição sem `auth` herda da pasta/collection ("Inherit auth from parent"); { type: 'noauth' } é "No Auth".
 */
import type { PmAuth } from './types'
import { resolveString, type Lookup } from './variables'

export type AuthType = 'inherit' | 'noauth' | 'basic' | 'bearer' | 'apikey' | 'oauth1' | 'oauth2'

export const AUTH_TYPES: { id: AuthType; label: string }[] = [
  { id: 'inherit', label: 'Inherit auth from parent' },
  { id: 'noauth', label: 'No Auth' },
  { id: 'basic', label: 'Basic Auth' },
  { id: 'bearer', label: 'Bearer Token' },
  { id: 'apikey', label: 'API Key' },
  { id: 'oauth1', label: 'OAuth 1.0' },
  { id: 'oauth2', label: 'OAuth 2.0' }
]

/** Tipos do Postman que o app ainda não implementa: ficam guardados e são exportados como vieram. */
export const isSupported = (t: string) => AUTH_TYPES.some((a) => a.id === t)

type Param = { key: string; value: unknown; type?: string }

export function params(auth: PmAuth | undefined): Param[] {
  if (!auth) return []
  const p = auth[auth.type]
  return Array.isArray(p) ? (p as Param[]) : []
}

export function getParam(auth: PmAuth | undefined, key: string, fallback = ''): string {
  const p = params(auth).find((x) => x.key === key)
  if (!p || p.value === undefined || p.value === null) return fallback
  return typeof p.value === 'string' ? p.value : String(p.value)
}

export function getBool(auth: PmAuth | undefined, key: string, fallback = false): boolean {
  const p = params(auth).find((x) => x.key === key)
  if (!p) return fallback
  return p.value === true || p.value === 'true'
}

/** Devolve uma cópia com o parâmetro trocado (ou acrescentado). */
export function setParam(auth: PmAuth, key: string, value: string | boolean): PmAuth {
  const list = [...params(auth)]
  const i = list.findIndex((x) => x.key === key)
  const p: Param = { key, value, type: typeof value === 'boolean' ? 'boolean' : 'string' }
  if (i >= 0) list[i] = p
  else list.push(p)
  return { ...auth, [auth.type]: list }
}

export function newAuth(type: AuthType): PmAuth | undefined {
  if (type === 'inherit') return undefined
  if (type === 'noauth') return { type: 'noauth' }
  const base: PmAuth = { type, [type]: [] }
  if (type === 'apikey') return setParam(base, 'in', 'header')
  if (type === 'oauth1')
    return setParam(setParam(setParam(base, 'signatureMethod', 'HMAC-SHA1'), 'version', '1.0'), 'addParamsToHeader', true)
  if (type === 'oauth2')
    return setParam(
      setParam(setParam(setParam(base, 'grant_type', 'authorization_code'), 'addTokenTo', 'header'), 'headerPrefix', 'Bearer'),
      'client_authentication',
      'header'
    )
  return base
}

export const authType = (a: PmAuth | undefined): AuthType => (a ? (a.type as AuthType) : 'inherit')

/** Escolhe o auth efetivo: o da requisição, senão o da pasta mais próxima, senão o da collection. */
export function effectiveAuth(
  own: PmAuth | undefined,
  parents: { auth?: PmAuth; name: string; kind: 'folder' | 'collection' }[]
): { auth: PmAuth | undefined; from: { kind: 'request' | 'folder' | 'collection'; name: string } | null } {
  if (own) return { auth: own, from: { kind: 'request', name: '' } }
  for (const p of parents) if (p.auth) return { auth: p.auth, from: { kind: p.kind, name: p.name } }
  return { auth: undefined, from: null }
}

/** Resolve {{variáveis}} em todos os parâmetros de texto do auth. */
export function resolveAuth(auth: PmAuth | undefined, lookup: Lookup): PmAuth | undefined {
  if (!auth) return auth
  return {
    ...auth,
    [auth.type]: params(auth).map((p) => (typeof p.value === 'string' ? { ...p, value: resolveString(p.value, lookup) } : p))
  }
}

function base64(s: string): string {
  let bin = ''
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b)
  return btoa(bin)
}

export interface SimpleAuthResult {
  headers: [string, string][]
  query: [string, string][]
}

/**
 * Basic, Bearer, API Key e OAuth 2.0 (uso do token): só acrescentam header ou query.
 * OAuth 1.0 precisa de assinatura e fica no main. Devolve null quando não há nada a aplicar.
 */
export function applySimpleAuth(auth: PmAuth | undefined): SimpleAuthResult | null {
  if (!auth) return null
  const out: SimpleAuthResult = { headers: [], query: [] }
  switch (auth.type) {
    case 'basic':
      out.headers.push(['Authorization', `Basic ${base64(`${getParam(auth, 'username')}:${getParam(auth, 'password')}`)}`])
      return out
    case 'bearer': {
      const t = getParam(auth, 'token')
      if (t) out.headers.push(['Authorization', `Bearer ${t}`])
      return out
    }
    case 'apikey': {
      const key = getParam(auth, 'key')
      if (!key) return out
      if (getParam(auth, 'in', 'header') === 'query') out.query.push([key, getParam(auth, 'value')])
      else out.headers.push([key, getParam(auth, 'value')])
      return out
    }
    case 'oauth2': {
      const token = getParam(auth, 'accessToken')
      if (!token) return out
      if (getParam(auth, 'addTokenTo', 'header') === 'queryParams') out.query.push(['access_token', token])
      else {
        const prefix = getParam(auth, 'headerPrefix', 'Bearer')
        out.headers.push(['Authorization', prefix ? `${prefix} ${token}` : token])
      }
      return out
    }
    default:
      return null
  }
}

/** Nome do header que o auth gera, para mostrar nos headers automáticos. */
export function authHeaderName(auth: PmAuth | undefined): string | null {
  if (!auth) return null
  if (auth.type === 'apikey') return getParam(auth, 'in', 'header') === 'header' ? getParam(auth, 'key') || null : null
  if (auth.type === 'oauth2') return getParam(auth, 'addTokenTo', 'header') === 'header' ? 'Authorization' : null
  if (auth.type === 'oauth1') return getBool(auth, 'addParamsToHeader', true) ? 'Authorization' : null
  if (auth.type === 'basic' || auth.type === 'bearer') return 'Authorization'
  return null
}
