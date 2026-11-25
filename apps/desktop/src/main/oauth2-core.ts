/** OAuth 2.0 sem Electron: pedidos ao token endpoint, refresh e leitura da config (usado também pelo CLI). */
import { createHash, randomBytes } from 'node:crypto'
import type { OAuth2Token } from '@shared/types'

export interface OAuth2Config {
  grantType: 'authorization_code' | 'authorization_code_with_pkce' | 'implicit' | 'password_credentials' | 'client_credentials'
  authUrl: string
  accessTokenUrl: string
  clientId: string
  clientSecret: string
  scope: string
  state: string
  redirectUri: string
  clientAuthentication: 'header' | 'body'
  username: string
  password: string
  codeVerifier: string
  challengeAlgorithm: 'S256' | 'plain'
  audience: string
  resource: string
  tokenName: string
}

export const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function pkcePair(verifier?: string, alg: 'S256' | 'plain' = 'S256') {
  const v = verifier || b64url(randomBytes(32))
  return { verifier: v, challenge: alg === 'plain' ? v : b64url(createHash('sha256').update(v).digest()) }
}

/** POST no token endpoint (form urlencoded); aceita resposta em JSON ou em form. */
export async function tokenRequest(cfg: OAuth2Config, form: Record<string, string>): Promise<Record<string, unknown>> {
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(form)) if (v !== '') body.set(k, v)
  if (cfg.scope && !body.has('scope') && form.grant_type !== 'authorization_code' && form.grant_type !== 'refresh_token') body.set('scope', cfg.scope)
  if (cfg.audience) body.set('audience', cfg.audience)
  if (cfg.resource) body.set('resource', cfg.resource)
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json'
  }
  if (cfg.clientAuthentication === 'header' && cfg.clientId) {
    headers.Authorization = 'Basic ' + Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString('base64')
  } else {
    if (cfg.clientId) body.set('client_id', cfg.clientId)
    if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret)
  }
  if (!cfg.accessTokenUrl) throw new Error('Informe o Access Token URL')
  const res = await fetch(cfg.accessTokenUrl, { method: 'POST', headers, body: body.toString() })
  const text = await res.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text)
  } catch {
    data = Object.fromEntries(new URLSearchParams(text))
  }
  if (!res.ok || data.error) {
    const msg = [data.error, data.error_description].filter(Boolean).join(': ') || `${res.status} ${res.statusText}`
    throw new Error(`O servidor recusou o token: ${msg}`)
  }
  if (!data.access_token) throw new Error('A resposta do token endpoint não trouxe access_token')
  return data
}

export function toToken(cfg: OAuth2Config, data: Record<string, unknown>, grant: string): OAuth2Token {
  const now = Date.now()
  const expiresIn = Number(data.expires_in)
  const extra: Record<string, string> = {}
  for (const [k, v] of Object.entries(data))
    if (!['access_token', 'refresh_token', 'token_type', 'expires_in', 'scope', 'id_token'].includes(k)) extra[k] = String(v)
  return {
    id: '',
    name: cfg.tokenName || 'Token',
    accessToken: String(data.access_token),
    tokenType: String(data.token_type ?? 'Bearer'),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    idToken: data.id_token ? String(data.id_token) : null,
    scope: data.scope ? String(data.scope) : cfg.scope || null,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : null,
    createdAt: now,
    grantType: grant,
    clientId: cfg.clientId,
    accessTokenUrl: cfg.accessTokenUrl,
    extra
  }
}

export async function refreshToken(t: OAuth2Token, cfg: OAuth2Config): Promise<OAuth2Token> {
  if (!t.refreshToken) throw new Error('Este token não tem refresh_token')
  const data = await tokenRequest({ ...cfg, accessTokenUrl: cfg.accessTokenUrl || t.accessTokenUrl }, { grant_type: 'refresh_token', refresh_token: t.refreshToken })
  const next = toToken(cfg, data, t.grantType)
  return { ...next, id: t.id, name: t.name, refreshToken: next.refreshToken ?? t.refreshToken, createdAt: t.createdAt }
}

/** Lê a config do auth oauth2 (parâmetros já com variáveis resolvidas). */
export function configFrom(get: (k: string, d?: string) => string): OAuth2Config {
  return {
    grantType: (get('grant_type', 'authorization_code') as OAuth2Config['grantType']) || 'authorization_code',
    authUrl: get('authUrl'),
    accessTokenUrl: get('accessTokenUrl'),
    clientId: get('clientId'),
    clientSecret: get('clientSecret'),
    scope: get('scope'),
    state: get('state'),
    redirectUri: get('redirect_uri', 'https://oauth.pstmn.io/v1/callback'),
    clientAuthentication: get('client_authentication', 'header') === 'body' ? 'body' : 'header',
    username: get('username'),
    password: get('password'),
    codeVerifier: get('code_verifier'),
    challengeAlgorithm: get('challengeAlgorithm', 'S256') === 'plain' ? 'plain' : 'S256',
    audience: get('audience'),
    resource: get('resource'),
    tokenName: get('tokenName')
  }
}
