import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { configFrom, isRedirectTarget, refreshToken, tokenRequest, toToken } from './oauth2-core'
import { DEFAULT_SETTINGS } from '@shared/types'

describe('isRedirectTarget: o callback é o endereço inteiro, não um prefixo', () => {
  it('reconhece o callback com query ou fragmento', () => {
    expect(isRedirectTarget('https://oauth.pstmn.io/v1/callback?code=1&state=x', 'https://oauth.pstmn.io/v1/callback')).toBe(true)
    expect(isRedirectTarget('http://localhost:3000/#access_token=a', 'http://localhost:3000')).toBe(true)
    expect(isRedirectTarget('http://LOCALHOST:3000/cb/?code=1', 'http://localhost:3000/cb')).toBe(true)
  })
  it('login no mesmo host do callback não conclui antes da hora', () => {
    expect(isRedirectTarget('http://localhost:3000/oauth/authorize?client_id=a', 'http://localhost:3000')).toBe(false)
    expect(isRedirectTarget('http://localhost:3000/login', 'http://localhost:3000/')).toBe(false)
  })
  it('prefixo parecido, outra porta ou outro esquema não valem', () => {
    expect(isRedirectTarget('https://oauth.pstmn.io/v1/callbackEVIL?code=1', 'https://oauth.pstmn.io/v1/callback')).toBe(false)
    expect(isRedirectTarget('http://localhost:3001/cb', 'http://localhost:3000/cb')).toBe(false)
    expect(isRedirectTarget('http://app.test/cb', 'https://app.test/cb')).toBe(false)
    expect(isRedirectTarget('não é url', 'http://x/cb')).toBe(false)
  })
})

describe('tokenRequest pelo envio do app', () => {
  let server: http.Server
  let base: string
  let last: { headers: http.IncomingHttpHeaders; body: string } | null = null
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        last = { headers: req.headers, body }
        if (req.url === '/hang') return
        if (req.url === '/bad') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'invalid_client', error_description: 'segredo errado' }))
        }
        if (req.url === '/form') {
          res.writeHead(200, { 'Content-Type': 'application/x-www-form-urlencoded' })
          return res.end('access_token=f1&token_type=bearer&expires_in=60')
        }
        const p = new URLSearchParams(body)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ access_token: `tok-${p.get('grant_type')}`, refresh_token: 'r2', expires_in: 3600, scope: 'ler' }))
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => {
    server.closeAllConnections()
    server.close()
  })

  const cfg = (path: string, extra: Record<string, string> = {}) =>
    configFrom((k, d = '') => ({ accessTokenUrl: `${base}${path}`, clientId: 'cli', clientSecret: 's3cr3t', scope: 'ler', ...extra })[k] ?? d)

  it('client_credentials com client auth no header Basic', async () => {
    const data = await tokenRequest(cfg('/token'), { grant_type: 'client_credentials' })
    expect(data.access_token).toBe('tok-client_credentials')
    expect(last!.headers.authorization).toBe('Basic ' + Buffer.from('cli:s3cr3t').toString('base64'))
    expect(last!.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(new URLSearchParams(last!.body).get('scope')).toBe('ler')
    const t = toToken(cfg('/token'), data, 'client_credentials')
    expect(t.refreshToken).toBe('r2')
    expect(t.expiresAt).toBeGreaterThan(Date.now())
  })
  it('client auth no corpo e resposta em form', async () => {
    const data = await tokenRequest(cfg('/form', { client_authentication: 'body' }), { grant_type: 'client_credentials' })
    expect(data.access_token).toBe('f1')
    const p = new URLSearchParams(last!.body)
    expect(p.get('client_id')).toBe('cli')
    expect(p.get('client_secret')).toBe('s3cr3t')
    expect(last!.headers.authorization).toBeUndefined()
  })
  it('erro do servidor aparece com error e error_description', async () => {
    await expect(tokenRequest(cfg('/bad'), { grant_type: 'client_credentials' })).rejects.toThrow('O servidor recusou o token: invalid_client: segredo errado')
  })
  it('respeita o timeout das Settings (antes o fetch podia ficar pendurado)', async () => {
    const t0 = Date.now()
    await expect(
      tokenRequest(cfg('/hang'), { grant_type: 'client_credentials' }, { settings: { ...DEFAULT_SETTINGS, requestTimeoutMs: 200 } })
    ).rejects.toThrow(/Falha ao pedir o token.*timed out/)
    expect(Date.now() - t0).toBeLessThan(5000)
  })
  it('refresh mantém id, nome e o refresh_token antigo quando o servidor não manda outro', async () => {
    const old = { ...toToken(cfg('/form'), { access_token: 'a', refresh_token: 'velho' }, 'authorization_code'), id: 'id1', name: 'Meu token' }
    const next = await refreshToken(old, cfg('/form'))
    expect(next).toMatchObject({ id: 'id1', name: 'Meu token', accessToken: 'f1', refreshToken: 'velho' })
    expect(new URLSearchParams(last!.body).get('grant_type')).toBe('refresh_token')
  })
})
