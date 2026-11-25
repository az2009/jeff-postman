import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, type AppSettings, type ClientCert, type SearchHit, type StoredCookie } from '@shared/types'
import { parseSetCookie } from '@shared/cookies'
import { generate, LANGUAGES, type Language } from '@shared/codegen'
import { applySimpleAuth } from '@shared/auth'
import { resolveDoc } from '@shared/variables'
import { autoContentType, normalizeUrl } from '@shared/http'
import { api } from '../api'
import { Icon } from '../icons'
import { lookupFor, methodClass, useStore } from '../store'
import { CodeEditor } from './CodeEditor'
import { useInherited } from './RequestEditor'
import { Toggle } from './Toggle'

function Modal({ title, onClose, children, wide }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="close" size={12} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

const errMsg = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// ---------------- Settings do app ----------------
export function SettingsDialog() {
  const open = useStore((s) => s.modal === 'settings')
  const close = useStore((s) => s.closeModal)
  const toast = useStore((s) => s.showToast)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const [tab, setTab] = useState<'general' | 'proxy' | 'certs'>('general')
  const [s, setS] = useState<AppSettings | null>(null)
  useEffect(() => {
    if (open) api.invoke('settings:get').then(setS)
  }, [open])
  if (!open || !s) return null
  const set = (patch: Partial<AppSettings>) => setS({ ...s, ...patch })
  const pick = async () => (await api.invoke('dialog:openFiles', false))[0] ?? null
  const save = async () => {
    try {
      setS(await api.invoke('settings:set', s))
      toast('Configurações salvas')
      close()
    } catch (e) {
      toast(`Não foi possível salvar: ${errMsg(e)}`, 'bad')
    }
  }
  return (
    <Modal title="Settings" onClose={close} wide>
      <div className="subtabs">
        {(
          [
            ['general', 'General'],
            ['proxy', 'Proxy'],
            ['certs', 'Certificates']
          ] as const
        ).map(([id, l]) => (
          <button key={id} className={`subtab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {l}
          </button>
        ))}
      </div>
      <div className="settings-body">
        {tab === 'general' && (
          <>
            <Opt label="Request timeout (ms)" hint="0 = sem limite">
              <input type="number" min={0} value={s.requestTimeoutMs} onChange={(e) => set({ requestTimeoutMs: Number(e.target.value) })} />
            </Opt>
            <Opt label="SSL certificate verification" hint="Desligado aceita certificados autoassinados (o Postman vem desligado)">
              <Toggle value={s.sslVerification} onChange={(v) => set({ sslVerification: v })} />
            </Opt>
            <Opt label="Automatically follow redirects">
              <Toggle value={s.followRedirects} onChange={(v) => set({ followRedirects: v })} />
            </Opt>
            <Opt label="Maximum number of redirects">
              <input type="number" min={0} max={50} value={s.maxRedirects} onChange={(e) => set({ maxRedirects: Number(e.target.value) })} />
            </Opt>
            <Opt label="Max response size (MB)">
              <input type="number" min={1} value={s.maxResponseMb} onChange={(e) => set({ maxResponseMb: Number(e.target.value) })} />
            </Opt>
            <Opt label="Send cookies automatically" hint="Guarda os Set-Cookie e reenvia nas próximas requisições do mesmo domínio">
              <Toggle value={s.sendCookies} onChange={(v) => set({ sendCookies: v })} />
            </Opt>
            <Opt label="Script timeout (ms)" hint="Tempo máximo de cada script síncrono">
              <input type="number" min={100} value={s.scriptTimeoutMs} onChange={(e) => set({ scriptTimeoutMs: Number(e.target.value) })} />
            </Opt>
            <Opt label="Theme">
              <select value={theme} onChange={(e) => setTheme(e.target.value as 'dark' | 'light')}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </Opt>
          </>
        )}
        {tab === 'proxy' && (
          <>
            <Opt label="Use custom proxy">
              <Toggle value={s.proxy.enabled} onChange={(v) => set({ proxy: { ...s.proxy, enabled: v } })} />
            </Opt>
            <Opt label="Proxy server" hint="Vale para HTTP e HTTPS (HTTPS por túnel CONNECT)">
              <div className="row-inputs">
                <input placeholder="host" value={s.proxy.host} onChange={(e) => set({ proxy: { ...s.proxy, host: e.target.value } })} />
                <input type="number" className="port" value={s.proxy.port} onChange={(e) => set({ proxy: { ...s.proxy, port: Number(e.target.value) } })} />
              </div>
            </Opt>
            <Opt label="Proxy auth">
              <Toggle value={s.proxy.auth} onChange={(v) => set({ proxy: { ...s.proxy, auth: v } })} />
            </Opt>
            {s.proxy.auth && (
              <Opt label="Username / Password">
                <div className="row-inputs">
                  <input placeholder="usuário" value={s.proxy.username} onChange={(e) => set({ proxy: { ...s.proxy, username: e.target.value } })} />
                  <input placeholder="senha" type="password" value={s.proxy.password} onChange={(e) => set({ proxy: { ...s.proxy, password: e.target.value } })} />
                </div>
              </Opt>
            )}
            <Opt label="Proxy bypass" hint="Hosts separados por vírgula; *.dominio.com vale para subdomínios">
              <input value={s.proxy.bypass} onChange={(e) => set({ proxy: { ...s.proxy, bypass: e.target.value } })} />
            </Opt>
          </>
        )}
        {tab === 'certs' && (
          <>
            <Opt label="CA certificates" hint="Arquivo PEM com a(s) CA(s) da sua empresa, além das do sistema">
              <div className="row-inputs">
                <Toggle value={s.ca.enabled} onChange={(v) => set({ ca: { ...s.ca, enabled: v } })} />
                <span className="file-chip" title={s.ca.path}>
                  {s.ca.path ? s.ca.path.split(/[\\/]/).pop() : 'nenhum arquivo'}
                </span>
                <button className="btn small" onClick={async () => (await pick().then((p) => p && set({ ca: { enabled: true, path: p } })))}>
                  Select File
                </button>
              </div>
            </Opt>
            <div className="certs-head">
              <b>Client certificates</b>
              <button
                className="btn small"
                onClick={() => set({ clientCerts: [...s.clientCerts, { id: crypto.randomUUID(), host: '', crtPath: '', keyPath: '', pfxPath: '', passphrase: '' }] })}
              >
                Add Certificate
              </button>
            </div>
            {s.clientCerts.length === 0 && <div className="muted">Nenhum certificado de cliente.</div>}
            {s.clientCerts.map((c, i) => {
              const up = (patch: Partial<ClientCert>) => set({ clientCerts: s.clientCerts.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
              const fileRow = (label: string, key: 'crtPath' | 'keyPath' | 'pfxPath') => (
                <div className="cert-file">
                  <span>{label}</span>
                  <span className="file-chip" title={c[key]}>
                    {c[key] ? c[key].split(/[\\/]/).pop() : '—'}
                  </span>
                  <button className="link" onClick={async () => (await pick().then((p) => p && up({ [key]: p })))}>
                    Select
                  </button>
                  {c[key] && (
                    <button className="link" onClick={() => up({ [key]: '' })}>
                      Remove
                    </button>
                  )}
                </div>
              )
              return (
                <div key={c.id} className="cert-card">
                  <div className="row-inputs">
                    <input placeholder="Host (ex.: api.exemplo.com ou *.exemplo.com:8443)" value={c.host} onChange={(e) => up({ host: e.target.value })} />
                    <button className="icon-btn" title="Remover" onClick={() => set({ clientCerts: s.clientCerts.filter((_, j) => j !== i) })}>
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                  {fileRow('CRT file', 'crtPath')}
                  {fileRow('KEY file', 'keyPath')}
                  {fileRow('PFX file', 'pfxPath')}
                  <input type="password" placeholder="Passphrase (opcional)" value={c.passphrase} onChange={(e) => up({ passphrase: e.target.value })} />
                </div>
              )
            })}
          </>
        )}
      </div>
      <div className="modal-foot">
        <button className="link" onClick={() => setS({ ...structuredClone(DEFAULT_SETTINGS), clientCerts: s.clientCerts })}>
          Restaurar padrões
        </button>
        <div className="spacer" />
        <span className="muted">Senhas ficam cifradas pelo Windows</span>
        <button className="btn ghost" onClick={close}>
          Cancel
        </button>
        <button className="btn primary" onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  )
}

function Opt({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="opt">
      <div className="opt-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="opt-ctl">{children}</div>
    </div>
  )
}

// ---------------- Cookies ----------------
export function CookieManager() {
  const open = useStore((s) => s.modal === 'cookies')
  const close = useStore((s) => s.closeModal)
  const toast = useStore((s) => s.showToast)
  const [list, setList] = useState<StoredCookie[]>([])
  const [domain, setDomain] = useState<string | null>(null)
  const [adding, setAdding] = useState('')
  const [newDomain, setNewDomain] = useState('')
  const load = () => api.invoke('cookies:list').then(setList)
  useEffect(() => {
    if (open) load()
  }, [open])
  const domains = useMemo(() => [...new Set(list.map((c) => c.domain))].sort(), [list])
  useEffect(() => {
    if (domain && !domains.includes(domain)) setDomain(domains[0] ?? null)
    if (!domain && domains.length) setDomain(domains[0])
  }, [domains, domain])
  if (!open) return null
  const shown = list.filter((c) => c.domain === domain)
  const add = async (d: string) => {
    const c = parseSetCookie(adding, new URL(`https://${d}/`))
    if (!c) return toast('Cookie inválido. Use o formato nome=valor; Path=/; Expires=...', 'bad')
    await api.invoke('cookies:save', c, null)
    setAdding('')
    await load()
    setDomain(c.domain)
  }
  return (
    <Modal title="Manage Cookies" onClose={close} wide>
      <div className="cookie-add">
        <input placeholder="Add domain (ex.: api.exemplo.com)" value={newDomain} onChange={(e) => setNewDomain(e.target.value.trim())} />
        <button className="btn small" disabled={!newDomain} onClick={() => (setDomain(newDomain), setNewDomain(''))}>
          Add
        </button>
        <div className="spacer" />
        <button
          className="link"
          disabled={!list.length}
          onClick={async () => {
            if (!confirm('Apagar todos os cookies de todos os domínios?')) return
            await api.invoke('cookies:clear', null)
            load()
          }}
        >
          Clear all
        </button>
      </div>
      <div className="cookie-body">
        <div className="cookie-domains">
          {[...new Set([...domains, ...(domain && !domains.includes(domain) ? [domain] : [])])].map((d) => (
            <div key={d} className={`row ${d === domain ? 'active' : ''}`} style={{ paddingLeft: 10 }} onClick={() => setDomain(d)}>
              <span className="row-name">{d}</span>
              <span className="muted">{list.filter((c) => c.domain === d).length}</span>
            </div>
          ))}
          {!domains.length && !domain && <div className="muted pad-s">Nenhum cookie ainda. Eles aparecem aqui quando uma resposta manda Set-Cookie.</div>}
        </div>
        <div className="cookie-list">
          {domain && (
            <>
              <table className="kv-table ro">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Value</th>
                    <th>Path</th>
                    <th>Expires</th>
                    <th>Flags</th>
                    <th className="kv-del" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={c.path + c.name}>
                      <td>{c.name}</td>
                      <td className="mono">
                        <input
                          className="cookie-val"
                          defaultValue={c.value}
                          onBlur={async (e) => {
                            if (e.target.value === c.value) return
                            await api.invoke('cookies:save', { ...c, value: e.target.value }, { domain: c.domain, path: c.path, name: c.name })
                            load()
                          }}
                        />
                      </td>
                      <td>{c.path}</td>
                      <td>{c.expires ? new Date(c.expires).toLocaleString('pt-BR') : 'Session'}</td>
                      <td className="muted">{[c.secure && 'Secure', c.httpOnly && 'HttpOnly', !c.hostOnly && 'subdomínios'].filter(Boolean).join(', ')}</td>
                      <td className="kv-del">
                        <button
                          className="icon-btn"
                          onClick={async () => {
                            await api.invoke('cookies:delete', c.domain, c.path, c.name)
                            load()
                          }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="cookie-add">
                <input placeholder="nome=valor; Path=/; Expires=Tue, 01 Dec 2026 00:00:00 GMT" value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && adding && add(domain)} />
                <button className="btn small" disabled={!adding} onClick={() => add(domain)}>
                  Add Cookie
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ---------------- Code snippet ----------------
export function CodeDialog() {
  const open = useStore((s) => s.modal === 'code')
  const close = useStore((s) => s.closeModal)
  const tab = useStore((s) => s.tabs.find((t) => t.key === s.activeTabKey))
  const globals = useStore((s) => s.globals)
  const collections = useStore((s) => s.collections)
  const environments = useStore((s) => s.environments)
  const activeEnvId = useStore((s) => s.activeEnvId)
  const toast = useStore((s) => s.showToast)
  const inherited = useInherited(tab?.collectionId ?? null, tab?.itemId ?? null)
  const [lang, setLang] = useState<Language>(() => (localStorage.getItem('codeLang') as Language) || 'curl')
  const code = useMemo(() => {
    if (!tab || tab.vars || tab.authOf || tab.runner) return ''
    const lookup = lookupFor({ globals, collections, environments, activeEnvId }, tab.collectionId)
    const d = resolveDoc(tab.doc, lookup)
    let url = normalizeUrl(d.request.url.raw)
    const headers: [string, string][] = d.request.header.filter((h) => !h.disabled && h.key).map((h) => [h.key, h.value])
    const has = (k: string) => headers.some(([x]) => x.toLowerCase() === k.toLowerCase())
    const ct = autoContentType(d.request.body)
    if (ct && !has('content-type')) headers.unshift(['Content-Type', ct])
    const auth = d.request.auth ?? inherited?.auth ?? undefined
    const simple = auth && auth.type !== 'noauth' ? applySimpleAuth(lookupAuth(auth, lookup)) : null
    if (simple) {
      for (const [k, v] of simple.headers) if (!has(k)) headers.push([k, v])
      if (simple.query.length) {
        try {
          const u = new URL(url)
          for (const [k, v] of simple.query) u.searchParams.append(k, v)
          url = u.toString()
        } catch {
          // URL inválida: deixa como está
        }
      }
    }
    const note = auth?.type === 'oauth1' ? 'OAuth 1.0: a assinatura é gerada a cada envio e não entra no código.' : ''
    const out = generate(lang, { method: d.request.method, url, headers, body: d.request.body })
    return note ? `${lang === 'python' ? '#' : lang === 'fetch' ? '//' : '#'} ${note}\n${out}` : out
  }, [tab, globals, collections, environments, activeEnvId, inherited, lang])
  if (!open) return null
  return (
    <Modal title="Code snippet" onClose={close} wide>
      <div className="code-head">
        <select
          value={lang}
          onChange={(e) => {
            setLang(e.target.value as Language)
            localStorage.setItem('codeLang', e.target.value)
          }}
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <span className="muted">Com as variáveis do environment ativo já trocadas.</span>
        <div className="spacer" />
        <button className="btn small" onClick={() => navigator.clipboard.writeText(code).then(() => toast('Código copiado'))}>
          Copy
        </button>
      </div>
      <div className="code-box">
        <CodeEditor value={code} language={LANGUAGES.find((l) => l.id === lang)!.editor} readOnly wordWrap />
      </div>
    </Modal>
  )
}

function lookupAuth<T extends { type: string }>(auth: T, lookup: Parameters<typeof resolveDoc>[1]): T {
  // resolve variáveis dos parâmetros do auth para o código sair pronto
  const list = (auth as unknown as Record<string, unknown>)[auth.type]
  if (!Array.isArray(list)) return auth
  return {
    ...auth,
    [auth.type]: list.map((p: { key: string; value: unknown }) =>
      typeof p.value === 'string' ? { ...p, value: resolveDoc({ name: '', request: { method: 'GET', url: { raw: p.value }, header: [] } }, lookup).request.url.raw } : p
    )
  }
}

// ---------------- Busca (Ctrl+K) ----------------
interface PaletteItem {
  kind: 'request' | 'collection' | 'environment'
  id: string
  label: string
  detail: string
  method?: string
  run(): void
}

export function SearchPalette() {
  const open = useStore((s) => s.modal === 'search')
  const close = useStore((s) => s.closeModal)
  const collections = useStore((s) => s.collections)
  const environments = useStore((s) => s.environments)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) {
      setQ('')
      setHits([])
      setSel(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => api.invoke('search:requests', q).then(setHits), 80)
    return () => clearTimeout(t)
  }, [q, open])
  const items: PaletteItem[] = useMemo(() => {
    const term = q.trim().toLowerCase()
    const st = useStore.getState()
    const out: PaletteItem[] = hits.map((h) => ({
      kind: 'request',
      id: h.id,
      label: h.name,
      detail: `${h.collectionName} · ${h.url}`,
      method: h.method,
      run: () => {
        const it = st.items[h.collectionId]?.find((i) => i.id === h.id)
        if (it) st.openItem(it)
      }
    }))
    if (term) {
      for (const c of collections)
        if (c.name.toLowerCase().includes(term))
          out.push({ kind: 'collection', id: c.id, label: c.name, detail: 'Collection', run: () => (st.setSidebarView('collections'), st.expand([c.id])) })
      for (const e of environments)
        if (e.name.toLowerCase().includes(term))
          out.push({ kind: 'environment', id: e.id, label: e.name, detail: 'Environment', run: () => st.openVariables({ type: 'environment', id: e.id }) })
    }
    return out
  }, [hits, q, collections, environments])
  if (!open) return null
  const choose = (i: number) => {
    const it = items[i]
    if (!it) return
    close()
    it.run()
  }
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" size={15} />
          <input
            ref={inputRef}
            placeholder="Buscar requisições (nome ou URL), collections e environments"
            value={q}
            onChange={(e) => (setQ(e.target.value), setSel(0))}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(items.length - 1, s + 1)))
              else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)))
              else if (e.key === 'Enter') choose(sel)
              else if (e.key === 'Escape') close()
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list">
          {q.trim() && items.length === 0 && <div className="muted pad-s">Nada encontrado.</div>}
          {!q.trim() && <div className="muted pad-s">Digite para buscar em todas as collections.</div>}
          {items.map((it, i) => (
            <div key={it.kind + it.id} className={`palette-row ${i === sel ? 'active' : ''}`} onMouseEnter={() => setSel(i)} onMouseDown={() => choose(i)}>
              {it.method ? (
                <span className={`row-method ${methodClass(it.method as never)}`}>{it.method === 'DELETE' ? 'DEL' : it.method}</span>
              ) : (
                <span className="row-icon">
                  <Icon name={it.kind === 'collection' ? 'collections' : 'environments'} size={14} />
                </span>
              )}
              <span className="palette-label">{it.label}</span>
              <span className="palette-detail">{it.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
