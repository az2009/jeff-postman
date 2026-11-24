import { useEffect, useState } from 'react'
import type { OAuth2Token } from '@shared/types'
import { api } from '../api'
import { Icon } from '../icons'
import { useStore } from '../store'

/** "Manage Access Tokens": lista, detalhes, usar, renovar e apagar tokens OAuth 2.0 guardados. */
export function TokenManager() {
  const open = useStore((s) => s.tokenManager)
  const close = useStore((s) => s.closeTokenManager)
  const tokens = useStore((s) => s.oauthTokens)
  const load = useStore((s) => s.loadTokens)
  const toast = useStore((s) => s.showToast)
  const [sel, setSel] = useState<string | null>(null)
  const [reveal, setReveal] = useState(false)

  useEffect(() => {
    if (!open) return
    load()
    setReveal(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, load, close])

  if (!open) return null
  const t = tokens.find((x) => x.id === sel) ?? tokens[0]

  const status = (x: OAuth2Token) =>
    !x.expiresAt ? 'sem validade informada' : x.expiresAt < Date.now() ? 'vencido' : `vence ${new Date(x.expiresAt).toLocaleString('pt-BR')}`

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal token-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Manage Access Tokens</span>
          <button className="icon-btn" onClick={close}>
            <Icon name="close" size={12} />
          </button>
        </div>
        {tokens.length === 0 ? (
          <div className="placeholder">Nenhum token ainda. Use "Get New Access Token" na aba Authorization (OAuth 2.0).</div>
        ) : (
          <div className="token-body">
            <div className="token-list">
              {tokens.map((x) => (
                <div key={x.id} className={`row ${t?.id === x.id ? 'active' : ''}`} onClick={() => (setSel(x.id), setReveal(false))}>
                  <span className={`tk-dot ${x.expiresAt && x.expiresAt < Date.now() ? 'old' : ''}`} />
                  <span className="row-name">{x.name}</span>
                </div>
              ))}
            </div>
            {t && (
              <div className="token-detail">
                <table className="ql-table">
                  <tbody>
                    <tr>
                      <td>Token Name</td>
                      <td>{t.name}</td>
                    </tr>
                    <tr>
                      <td>Access Token</td>
                      <td className="mono wrap">{reveal ? t.accessToken : `${t.accessToken.slice(0, 6)}••••••••`}</td>
                    </tr>
                    <tr>
                      <td>Token Type</td>
                      <td>{t.tokenType}</td>
                    </tr>
                    <tr>
                      <td>Status</td>
                      <td>{status(t)}</td>
                    </tr>
                    <tr>
                      <td>Grant</td>
                      <td>{t.grantType}</td>
                    </tr>
                    <tr>
                      <td>Client ID</td>
                      <td>{t.clientId}</td>
                    </tr>
                    {t.scope && (
                      <tr>
                        <td>Scope</td>
                        <td>{t.scope}</td>
                      </tr>
                    )}
                    <tr>
                      <td>Refresh Token</td>
                      <td>{t.refreshToken ? 'sim' : 'não'}</td>
                    </tr>
                    <tr>
                      <td>Obtido em</td>
                      <td>{new Date(t.createdAt).toLocaleString('pt-BR')}</td>
                    </tr>
                    {Object.entries(t.extra).map(([k, v]) => (
                      <tr key={k}>
                        <td>{k}</td>
                        <td className="mono wrap">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="modal-foot">
                  <button className="btn ghost small" onClick={() => setReveal((r) => !r)}>
                    {reveal ? 'Ocultar' : 'Mostrar token'}
                  </button>
                  <button className="btn ghost small" onClick={() => navigator.clipboard.writeText(t.accessToken).then(() => toast('Token copiado'))}>
                    Copiar
                  </button>
                  {t.refreshToken && (
                    <button
                      className="btn ghost small"
                      onClick={async () => {
                        try {
                          await api.invoke('oauth2:refresh', t.id, null, null, null)
                          await load()
                          toast('Token renovado')
                        } catch (e) {
                          toast(`Falha ao renovar: ${(e as Error).message}`, 'bad')
                        }
                      }}
                    >
                      Refresh
                    </button>
                  )}
                  <button
                    className="btn ghost small danger-text"
                    onClick={async () => {
                      if (!confirm(`Apagar o token "${t.name}"?`)) return
                      await api.invoke('oauth2:deleteToken', t.id)
                      setSel(null)
                      await load()
                    }}
                  >
                    Delete
                  </button>
                  <div className="spacer" />
                  {useStore.getState().tokenPick && (
                    <button className="btn primary small" onClick={() => (useStore.getState().tokenPick?.(t), close())}>
                      Use Token
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
