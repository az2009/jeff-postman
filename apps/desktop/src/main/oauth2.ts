/**
 * OAuth 2.0: Authorization Code (com e sem PKCE), Implicit, Password Credentials e Client Credentials,
 * mais refresh. O login abre numa janela própria (sessão isolada) e o app captura o redirect.
 */
import { BrowserWindow, session } from 'electron'
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

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function pkcePair(verifier?: string, alg: 'S256' | 'plain' = 'S256') {
  const v = verifier || b64url(randomBytes(32))
  return { verifier: v, challenge: alg === 'plain' ? v : b64url(createHash('sha256').update(v).digest()) }
}

/** POST no token endpoint (form urlencoded); aceita resposta em JSON ou em form. */
async function tokenRequest(cfg: OAuth2Config, form: Record<string, string>): Promise<Record<string, unknown>> {
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

function toToken(cfg: OAuth2Config, data: Record<string, unknown>, grant: string): OAuth2Token {
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

/** Abre a página de login e espera o navegador ir para o redirect_uri. Devolve a URL final. */
function captureRedirect(authorizeUrl: string, redirectUri: string, parent: BrowserWindow | null): Promise<URL> {
  return new Promise((resolve, reject) => {
    const partition = `oauth-${Date.now()}`
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      parent: parent ?? undefined,
      modal: false,
      title: 'Login (OAuth 2.0)',
      autoHideMenuBar: true,
      webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    let done = false
    const target = redirectUri.split(/[?#]/)[0]
    const finish = (err: Error | null, url?: URL) => {
      if (done) return
      done = true
      session.fromPartition(partition).webRequest.onBeforeRequest(null)
      if (!win.isDestroyed()) win.destroy()
      if (err) reject(err)
      else resolve(url!)
    }
    // o redirect_uri normalmente não existe (ou é um site externo): intercepta antes de carregar
    session.fromPartition(partition).webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
      if (details.url.startsWith(target)) {
        cb({ cancel: true })
        finish(null, new URL(details.url))
      } else cb({})
    })
    const check = (_e: unknown, url: string) => {
      if (url.startsWith(target)) finish(null, new URL(url))
    }
    win.webContents.on('will-redirect', check)
    win.webContents.on('will-navigate', check)
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      if (url.startsWith(target)) finish(null, new URL(url))
      else if (code !== -3) finish(new Error(`Falha ao abrir a página de login: ${desc} (${code})`))
    })
    win.on('closed', () => finish(new Error('Janela de login fechada antes de concluir')))
    win.loadURL(authorizeUrl).catch(() => undefined)
  })
}

export async function getNewToken(cfg: OAuth2Config, parent: BrowserWindow | null): Promise<OAuth2Token> {
  switch (cfg.grantType) {
    case 'client_credentials':
      return toToken(cfg, await tokenRequest(cfg, { grant_type: 'client_credentials' }), cfg.grantType)
    case 'password_credentials':
      return toToken(cfg, await tokenRequest(cfg, { grant_type: 'password', username: cfg.username, password: cfg.password }), cfg.grantType)
    case 'authorization_code':
    case 'authorization_code_with_pkce':
    case 'implicit': {
      if (!cfg.authUrl) throw new Error('Informe o Auth URL')
      if (!cfg.redirectUri) throw new Error('Informe o Callback URL')
      const implicit = cfg.grantType === 'implicit'
      const pkce = cfg.grantType === 'authorization_code_with_pkce' ? pkcePair(cfg.codeVerifier, cfg.challengeAlgorithm) : null
      const state = cfg.state || b64url(randomBytes(12))
      const u = new URL(cfg.authUrl)
      u.searchParams.set('response_type', implicit ? 'token' : 'code')
      u.searchParams.set('client_id', cfg.clientId)
      u.searchParams.set('redirect_uri', cfg.redirectUri)
      if (cfg.scope) u.searchParams.set('scope', cfg.scope)
      u.searchParams.set('state', state)
      if (cfg.audience) u.searchParams.set('audience', cfg.audience)
      if (pkce) {
        u.searchParams.set('code_challenge', pkce.challenge)
        u.searchParams.set('code_challenge_method', cfg.challengeAlgorithm)
      }
      const back = await captureRedirect(u.toString(), cfg.redirectUri, parent)
      const p = implicit ? new URLSearchParams(back.hash.replace(/^#/, '')) : back.searchParams
      if (p.get('error')) throw new Error(`Login recusado: ${[p.get('error'), p.get('error_description')].filter(Boolean).join(': ')}`)
      if (p.get('state') !== state) throw new Error('O state voltou diferente do enviado (possível ataque CSRF); token não pedido')
      if (implicit) {
        const data: Record<string, unknown> = Object.fromEntries(p)
        if (!data.access_token) throw new Error('O redirect não trouxe access_token')
        return toToken(cfg, data, cfg.grantType)
      }
      const code = p.get('code')
      if (!code) throw new Error('O redirect não trouxe o code')
      const form: Record<string, string> = { grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri }
      if (pkce) form.code_verifier = pkce.verifier
      return toToken(cfg, await tokenRequest(cfg, form), cfg.grantType)
    }
    default:
      throw new Error(`Grant type não suportado: ${cfg.grantType}`)
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
