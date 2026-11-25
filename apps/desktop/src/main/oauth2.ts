/**
 * OAuth 2.0: Authorization Code (com e sem PKCE), Implicit, Password Credentials e Client Credentials,
 * mais refresh. O login abre numa janela própria (sessão isolada) e o app captura o redirect.
 */
import { BrowserWindow, session } from 'electron'
import { randomBytes } from 'node:crypto'
import type { OAuth2Token } from '@shared/types'
import { b64url, pkcePair, tokenRequest, toToken, type OAuth2Config } from './oauth2-core'

export { configFrom, refreshToken, type OAuth2Config } from './oauth2-core'

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

