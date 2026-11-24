import { useEffect, useState, type ReactNode } from 'react'
import type { InheritedAuth, OAuth2Token, PmAuth } from '@shared/types'
import { AUTH_TYPES, authType, getBool, getParam, isSupported, newAuth, setParam, type AuthType } from '@shared/auth'
import { api } from '../api'
import { useStore } from '../store'
import { Icon } from '../icons'
import { VarInput } from './VarInput'

interface Props {
  auth: PmAuth | undefined
  onChange(auth: PmAuth | undefined): void
  /** requisição e pasta podem herdar; collection não */
  allowInherit: boolean
  inherited?: InheritedAuth | null
  collectionId: string | null
}

const DESCRIPTION: Record<AuthType, string> = {
  inherit: 'A requisição usa o auth da pasta ou da collection onde está.',
  noauth: 'Nenhum header de autorização é enviado.',
  basic: 'Envia o header Authorization: Basic com usuário e senha em base64.',
  bearer: 'Envia o header Authorization: Bearer <token>.',
  apikey: 'Envia a chave num header ou num parâmetro da URL.',
  oauth1: 'Assina cada requisição (RFC 5849). A assinatura é gerada no envio.',
  oauth2: 'Usa um access token obtido por um dos fluxos do OAuth 2.0.'
}

export function AuthEditor({ auth, onChange, allowInherit, inherited, collectionId }: Props) {
  const type = authType(auth)
  const unsupported = auth && !isSupported(auth.type)
  const set = (k: string, v: string | boolean) => auth && onChange(setParam(auth, k, v))
  const options = AUTH_TYPES.filter((t) => allowInherit || t.id !== 'inherit')

  return (
    <div className="auth-editor">
      <div className="auth-left">
        <label className="auth-label">Auth Type</label>
        <select
          className="auth-type"
          value={unsupported ? '__other' : allowInherit ? type : type === 'inherit' ? 'noauth' : type}
          onChange={(e) => onChange(newAuth(e.target.value as AuthType))}
        >
          {unsupported && <option value="__other">{auth!.type} (não suportado)</option>}
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <p className="auth-desc">{unsupported ? 'Tipo importado que o app ainda não aplica; é preservado na exportação.' : DESCRIPTION[type]}</p>
        {(type === 'basic' || type === 'bearer' || type === 'apikey' || type === 'oauth1' || type === 'oauth2') && (
          <p className="auth-desc muted">Use {'{{variáveis}}'} para não deixar segredos gravados na requisição.</p>
        )}
      </div>

      <div className="auth-right">
        {type === 'inherit' && (
          <div className="auth-inherit">
            {inherited?.from ? (
              <>
                Esta requisição está usando <b>{AUTH_TYPES.find((t) => t.id === inherited.auth?.type)?.label ?? inherited.auth?.type}</b> da{' '}
                {inherited.from.kind === 'folder' ? 'pasta' : 'collection'} <b>{inherited.from.name}</b>.
              </>
            ) : collectionId ? (
              'Nem a pasta nem a collection têm auth: nenhum header de autorização é enviado.'
            ) : (
              'Requisição fora de collection: não há de onde herdar. Salve numa collection ou escolha um tipo.'
            )}
          </div>
        )}
        {type === 'noauth' && <div className="auth-inherit">Esta requisição não usa autorização.</div>}

        {auth && type === 'basic' && (
          <>
            <Field label="Username" value={getParam(auth, 'username')} onChange={(v) => set('username', v)} />
            <Field label="Password" secret value={getParam(auth, 'password')} onChange={(v) => set('password', v)} />
          </>
        )}

        {auth && type === 'bearer' && <Field label="Token" secret value={getParam(auth, 'token')} onChange={(v) => set('token', v)} />}

        {auth && type === 'apikey' && (
          <>
            <Field label="Key" value={getParam(auth, 'key')} onChange={(v) => set('key', v)} />
            <Field label="Value" secret value={getParam(auth, 'value')} onChange={(v) => set('value', v)} />
            <Select
              label="Add to"
              value={getParam(auth, 'in', 'header')}
              onChange={(v) => set('in', v)}
              options={[
                ['header', 'Header'],
                ['query', 'Query Params']
              ]}
            />
          </>
        )}

        {auth && type === 'oauth1' && <OAuth1Form auth={auth} set={set} />}
        {auth && type === 'oauth2' && <OAuth2Form auth={auth} onChange={onChange} collectionId={collectionId} />}
      </div>
    </div>
  )
}

function OAuth1Form({ auth, set }: { auth: PmAuth; set(k: string, v: string | boolean): void }) {
  const method = getParam(auth, 'signatureMethod', 'HMAC-SHA1')
  const rsa = method.startsWith('RSA')
  const [adv, setAdv] = useState(false)
  return (
    <>
      <Select
        label="Signature Method"
        value={method}
        onChange={(v) => set('signatureMethod', v)}
        options={['HMAC-SHA1', 'HMAC-SHA256', 'HMAC-SHA512', 'RSA-SHA1', 'RSA-SHA256', 'RSA-SHA512', 'PLAINTEXT'].map((m) => [m, m])}
      />
      <Field label="Consumer Key" value={getParam(auth, 'consumerKey')} onChange={(v) => set('consumerKey', v)} />
      {!rsa && <Field label="Consumer Secret" secret value={getParam(auth, 'consumerSecret')} onChange={(v) => set('consumerSecret', v)} />}
      <Field label="Access Token" value={getParam(auth, 'token')} onChange={(v) => set('token', v)} />
      {!rsa && <Field label="Token Secret" secret value={getParam(auth, 'tokenSecret')} onChange={(v) => set('tokenSecret', v)} />}
      {rsa && (
        <div className="auth-field">
          <label>Private Key</label>
          <textarea
            className="auth-textarea"
            spellCheck={false}
            placeholder="-----BEGIN PRIVATE KEY-----"
            value={getParam(auth, 'privateKey')}
            onChange={(e) => set('privateKey', e.target.value)}
          />
        </div>
      )}
      <Select
        label="Add authorization data to"
        value={getBool(auth, 'addParamsToHeader', true) ? 'header' : 'body'}
        onChange={(v) => set('addParamsToHeader', v === 'header')}
        options={[
          ['header', 'Request Headers'],
          ['body', 'Request Body / Request URL']
        ]}
      />
      <button className="link adv" onClick={() => setAdv((a) => !a)}>
        {adv ? '▾' : '▸'} Advanced configuration
      </button>
      {adv && (
        <>
          <Field label="Callback URL" value={getParam(auth, 'callback')} onChange={(v) => set('callback', v)} />
          <Field label="Verifier" value={getParam(auth, 'verifier')} onChange={(v) => set('verifier', v)} />
          <Field label="Timestamp" placeholder="gerado no envio" value={getParam(auth, 'timestamp')} onChange={(v) => set('timestamp', v)} />
          <Field label="Nonce" placeholder="gerado no envio" value={getParam(auth, 'nonce')} onChange={(v) => set('nonce', v)} />
          <Field label="Version" value={getParam(auth, 'version', '1.0')} onChange={(v) => set('version', v)} />
          <Field label="Realm" value={getParam(auth, 'realm')} onChange={(v) => set('realm', v)} />
          <Check label="Include body hash" value={getBool(auth, 'includeBodyHash')} onChange={(v) => set('includeBodyHash', v)} />
          <Check label="Add empty parameters to signature" value={getBool(auth, 'addEmptyParamsToSign')} onChange={(v) => set('addEmptyParamsToSign', v)} />
        </>
      )}
    </>
  )
}

const GRANTS: [string, string][] = [
  ['authorization_code', 'Authorization Code'],
  ['authorization_code_with_pkce', 'Authorization Code (With PKCE)'],
  ['implicit', 'Implicit'],
  ['password_credentials', 'Password Credentials'],
  ['client_credentials', 'Client Credentials']
]

function OAuth2Form({ auth, onChange, collectionId }: { auth: PmAuth; onChange(a: PmAuth): void; collectionId: string | null }) {
  const set = (k: string, v: string | boolean) => onChange(setParam(auth, k, v))
  const grant = getParam(auth, 'grant_type', 'authorization_code')
  const tokens = useStore((s) => s.oauthTokens)
  const loadTokens = useStore((s) => s.loadTokens)
  const openManager = useStore((s) => s.openTokenManager)
  const toast = useStore((s) => s.showToast)
  const activeEnvId = useStore((s) => s.activeEnvId)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    loadTokens()
  }, [loadTokens])

  const browserFlow = grant === 'authorization_code' || grant === 'authorization_code_with_pkce' || grant === 'implicit'
  const tokenId = getParam(auth, 'jp_tokenId')

  const useToken = (t: OAuth2Token) => {
    let a = setParam(auth, 'accessToken', t.accessToken)
    a = setParam(a, 'tokenType', t.tokenType)
    a = setParam(a, 'jp_tokenId', t.id)
    onChange(a)
  }

  const getNew = async () => {
    setBusy(true)
    try {
      const t = await api.invoke('oauth2:getToken', auth, collectionId, activeEnvId)
      await loadTokens()
      useToken(t)
      toast(`Token "${t.name}" obtido${t.expiresAt ? `, vence às ${new Date(t.expiresAt).toLocaleTimeString('pt-BR')}` : ''}`)
    } catch (e) {
      toast(`Não foi possível obter o token: ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="auth-section">Current Token</div>
      <div className="auth-field">
        <label>Token</label>
        <div className="token-row">
          <select
            value={tokenId}
            onChange={(e) => {
              const t = tokens.find((x) => x.id === e.target.value)
              if (t) useToken(t)
              else onChange(setParam(setParam(auth, 'jp_tokenId', ''), 'accessToken', getParam(auth, 'accessToken')))
            }}
          >
            <option value="">{tokens.length ? 'Escolher token salvo…' : 'Nenhum token salvo'}</option>
            {tokens.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} {t.expiresAt && t.expiresAt < Date.now() ? '(vencido)' : ''}
              </option>
            ))}
          </select>
          <button className="link" onClick={() => openManager(useToken)}>
            Manage tokens
          </button>
        </div>
      </div>
      <Field label="Access Token" secret value={getParam(auth, 'accessToken')} onChange={(v) => onChange(setParam(setParam(auth, 'accessToken', v), 'jp_tokenId', ''))} />
      <Field label="Header Prefix" value={getParam(auth, 'headerPrefix', 'Bearer')} onChange={(v) => set('headerPrefix', v)} />
      <Select
        label="Add token to"
        value={getParam(auth, 'addTokenTo', 'header')}
        onChange={(v) => set('addTokenTo', v)}
        options={[
          ['header', 'Request Headers'],
          ['queryParams', 'Request URL']
        ]}
      />
      <Check label="Auto-refresh token (usa o refresh_token antes de vencer)" value={getBool(auth, 'jp_autoRefresh', true)} onChange={(v) => set('jp_autoRefresh', v)} />

      <div className="auth-section">Configure New Token</div>
      <Field label="Token Name" value={getParam(auth, 'tokenName')} onChange={(v) => set('tokenName', v)} />
      <Select label="Grant Type" value={grant} onChange={(v) => set('grant_type', v)} options={GRANTS} />
      {browserFlow && (
        <>
          <Field label="Callback URL" placeholder="https://oauth.pstmn.io/v1/callback" value={getParam(auth, 'redirect_uri')} onChange={(v) => set('redirect_uri', v)} />
          <Field label="Auth URL" value={getParam(auth, 'authUrl')} onChange={(v) => set('authUrl', v)} />
        </>
      )}
      {grant !== 'implicit' && <Field label="Access Token URL" value={getParam(auth, 'accessTokenUrl')} onChange={(v) => set('accessTokenUrl', v)} />}
      <Field label="Client ID" value={getParam(auth, 'clientId')} onChange={(v) => set('clientId', v)} />
      {grant !== 'implicit' && <Field label="Client Secret" secret value={getParam(auth, 'clientSecret')} onChange={(v) => set('clientSecret', v)} />}
      {grant === 'authorization_code_with_pkce' && (
        <>
          <Select
            label="Code Challenge Method"
            value={getParam(auth, 'challengeAlgorithm', 'S256')}
            onChange={(v) => set('challengeAlgorithm', v)}
            options={[
              ['S256', 'SHA-256'],
              ['plain', 'Plain']
            ]}
          />
          <Field label="Code Verifier" placeholder="gerado automaticamente se vazio" value={getParam(auth, 'code_verifier')} onChange={(v) => set('code_verifier', v)} />
        </>
      )}
      {grant === 'password_credentials' && (
        <>
          <Field label="Username" value={getParam(auth, 'username')} onChange={(v) => set('username', v)} />
          <Field label="Password" secret value={getParam(auth, 'password')} onChange={(v) => set('password', v)} />
        </>
      )}
      <Field label="Scope" placeholder="ex.: read:user repo" value={getParam(auth, 'scope')} onChange={(v) => set('scope', v)} />
      {browserFlow && <Field label="State" placeholder="gerado automaticamente se vazio" value={getParam(auth, 'state')} onChange={(v) => set('state', v)} />}
      {grant !== 'implicit' && (
        <Select
          label="Client Authentication"
          value={getParam(auth, 'client_authentication', 'header')}
          onChange={(v) => set('client_authentication', v)}
          options={[
            ['header', 'Send as Basic Auth header'],
            ['body', 'Send client credentials in body']
          ]}
        />
      )}
      <Field label="Audience" value={getParam(auth, 'audience')} onChange={(v) => set('audience', v)} />
      <div className="auth-actions">
        <button className="btn primary" disabled={busy} onClick={getNew}>
          {busy ? (browserFlow ? 'Aguardando o login…' : 'Pedindo token…') : 'Get New Access Token'}
        </button>
      </div>
    </>
  )
}

// ---------- campos ----------
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="auth-field">
      <label>{label}</label>
      {children}
    </div>
  )
}

function Field({ label, value, onChange, secret, placeholder }: { label: string; value: string; onChange(v: string): void; secret?: boolean; placeholder?: string }) {
  const [show, setShow] = useState(false)
  const isVar = /^\s*\{\{[^}]+\}\}\s*$/.test(value)
  return (
    <Row label={label}>
      <div className="auth-input">
        {secret && !show && !isVar && value ? (
          <input type="password" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <VarInput value={value} placeholder={placeholder ?? label} onChange={onChange} />
        )}
        {secret && value && !isVar && (
          <button className="icon-btn" title={show ? 'Ocultar' : 'Mostrar'} onClick={() => setShow((s) => !s)}>
            <Icon name="eye" size={14} />
          </button>
        )}
      </div>
    </Row>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange(v: string): void; options: [string, string][] }) {
  return (
    <Row label={label}>
      <select className="auth-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </Row>
  )
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange(v: boolean): void }) {
  return (
    <label className="auth-check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
