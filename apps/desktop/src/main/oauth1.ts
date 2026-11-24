/** Assinatura OAuth 1.0a (RFC 5849): HMAC-SHA1/256/512, RSA-SHA1/256/512 e PLAINTEXT. */
import { createHash, createHmac, createSign, randomBytes } from 'node:crypto'

export type SignatureMethod = 'HMAC-SHA1' | 'HMAC-SHA256' | 'HMAC-SHA512' | 'RSA-SHA1' | 'RSA-SHA256' | 'RSA-SHA512' | 'PLAINTEXT'

export interface OAuth1Config {
  consumerKey: string
  consumerSecret: string
  token?: string
  tokenSecret?: string
  signatureMethod: SignatureMethod
  timestamp?: string
  nonce?: string
  version?: string
  realm?: string
  callback?: string
  verifier?: string
  privateKey?: string
  includeBodyHash?: boolean
  addEmptyParamsToSign?: boolean
}

/** Percent-encoding da RFC 3986 (o encodeURIComponent deixa !'()* de fora). */
export const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())

/** URL base da assinatura: esquema e host em minúsculas, sem porta padrão, sem query nem fragmento. */
export function baseUrl(u: URL): string {
  const scheme = u.protocol.replace(':', '').toLowerCase()
  const host = u.hostname.toLowerCase()
  const port = u.port && !((scheme === 'http' && u.port === '80') || (scheme === 'https' && u.port === '443')) ? `:${u.port}` : ''
  return `${scheme}://${host}${port}${u.pathname}`
}

/** Decodifica application/x-www-form-urlencoded mantendo a ordem e chaves repetidas. */
function decodePairs(qs: string): [string, string][] {
  if (!qs) return []
  return qs.split('&').filter(Boolean).map((p) => {
    const i = p.indexOf('=')
    const dec = (s: string) => decodeURIComponent(s.replace(/\+/g, ' '))
    return i < 0 ? [dec(p), ''] : [dec(p.slice(0, i)), dec(p.slice(i + 1))]
  })
}

export interface SignInput {
  method: string
  url: URL
  /** corpo x-www-form-urlencoded (entra na assinatura) */
  formBody?: string | null
  /** corpo bruto de outro tipo (para oauth_body_hash) */
  rawBody?: Buffer | null
}

export interface SignResult {
  oauthParams: [string, string][]
  signature: string
  baseString: string
  header: string
}

export function sign(cfg: OAuth1Config, input: SignInput): SignResult {
  const method = cfg.signatureMethod
  const oauth: [string, string][] = [
    ['oauth_consumer_key', cfg.consumerKey],
    ['oauth_signature_method', method],
    ['oauth_timestamp', cfg.timestamp || String(Math.floor(Date.now() / 1000))],
    ['oauth_nonce', cfg.nonce || randomBytes(16).toString('hex')]
  ]
  const opt = (k: string, v: string | undefined) => {
    if (v) oauth.push([k, v])
    else if (cfg.addEmptyParamsToSign && v !== undefined) oauth.push([k, ''])
  }
  opt('oauth_token', cfg.token)
  opt('oauth_version', cfg.version)
  opt('oauth_callback', cfg.callback)
  opt('oauth_verifier', cfg.verifier)
  if (cfg.includeBodyHash && !input.formBody && input.rawBody) {
    const alg = method.endsWith('256') ? 'sha256' : method.endsWith('512') ? 'sha512' : 'sha1'
    oauth.push(['oauth_body_hash', createHash(alg).update(input.rawBody).digest('base64')])
  }

  const all: [string, string][] = [
    ...decodePairs(input.url.search.replace(/^\?/, '')),
    ...decodePairs(input.formBody ?? ''),
    ...oauth
  ]
  const normalized = all
    .map(([k, v]) => [pct(k), pct(v)] as [string, string])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const baseString = [input.method.toUpperCase(), pct(baseUrl(input.url)), pct(normalized)].join('&')
  const key = `${pct(cfg.consumerSecret)}&${pct(cfg.tokenSecret ?? '')}`

  let signature: string
  switch (method) {
    case 'HMAC-SHA1':
    case 'HMAC-SHA256':
    case 'HMAC-SHA512':
      signature = createHmac(method.slice(5).toLowerCase().replace('sha', 'sha'), key).update(baseString).digest('base64')
      break
    case 'RSA-SHA1':
    case 'RSA-SHA256':
    case 'RSA-SHA512': {
      if (!cfg.privateKey) throw new Error('OAuth 1.0: a assinatura RSA precisa da chave privada (PEM)')
      signature = createSign(`RSA-${method.slice(4)}`).update(baseString).sign(cfg.privateKey, 'base64')
      break
    }
    case 'PLAINTEXT':
      signature = key
      break
    default:
      throw new Error(`OAuth 1.0: método de assinatura desconhecido: ${method}`)
  }

  const headerParams: [string, string][] = [...oauth, ['oauth_signature', signature]]
  const header =
    'OAuth ' +
    [...(cfg.realm ? [['realm', cfg.realm] as [string, string]] : []), ...headerParams].map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(',')
  return { oauthParams: headerParams, signature, baseString, header }
}
