import { useEffect, useMemo, useState } from 'react'
import type { HttpResponse } from '@shared/types'
import { formatBytes, formatMs } from '@shared/http'
import { Icon } from '../icons'
import { useStore, type RunState } from '../store'
import { CodeEditor } from './CodeEditor'
import { TestResults, testCounts } from './TestResults'
import type { ScriptsReport } from '@shared/types'
import { decodeText, languageFromContentType, prettyJson } from '../format'
import { bodyInfo, dispositionFilename } from '@shared/binary'
import { api } from '../api'
import { EntryConsole, entryLogCount } from './ConsolePanel'
import type { ConsoleEntry } from '../store'

type ResTab = 'body' | 'cookies' | 'headers' | 'tests' | 'console'
type View = 'pretty' | 'raw' | 'preview'

const PRETTY_LIMIT = 5 * 1024 * 1024

export function ResponsePane({ run }: { run: RunState | null }) {
  const cancel = useStore((s) => s.cancelActive)

  if (!run)
    return (
      <div className="response-empty">
        <Icon name="rocket" size={40} />
        <p>Enter the URL and click Send to get a response</p>
      </div>
    )
  if (run.state === 'loading')
    return (
      <div className="response-empty">
        <div className="spinner" />
        <p>Sending request...</p>
        <button className="btn small" onClick={cancel}>Cancel</button>
      </div>
    )
  if (run.state === 'skipped')
    return (
      <div className="response-stack">
        <div className="response-empty">
          <p>Requisição pulada pelo pre-request script (pm.execution.skipRequest)</p>
        </div>
        <InlineConsole entry={run.console} />
      </div>
    )
  if (run.state === 'cancelled')
    return (
      <div className="response-empty">
        <p>Request cancelled</p>
      </div>
    )
  if (run.state === 'error')
    return (
      <div className="response-stack">
        <div className="response-error">
          <h3>Could not send request</h3>
          <p className="err-msg">
            Error: {run.error}
            {run.code ? <span className="err-code"> ({run.code})</span> : null}
          </p>
          {run.request && (
            <p className="err-detail">
              {run.request.method} {run.request.url}
            </p>
          )}
          <p className="err-hint">
            {run.code === 'SCRIPT_ERROR' ? 'Corrija o script em Scripts → Pre-request (ou na collection/pasta).' : 'Confira a URL, a rede e se o servidor está no ar.'} Os logs deste envio estão abaixo.
          </p>
        </div>
        <InlineConsole entry={run.console} />
      </div>
    )
  return <ResponseView res={run.response} entry={run.console} />
}

/** Console do envio que não teve resposta (erro ou pulado). */
function InlineConsole({ entry }: { entry: ConsoleEntry | undefined }) {
  if (!entry) return null
  return (
    <div className="inline-console">
      <div className="inline-console-head">Console</div>
      <div className="console-list">
        <EntryConsole e={entry} />
      </div>
    </div>
  )
}

function ResponseView({ res, entry }: { res: HttpResponse; entry?: ConsoleEntry }) {
  const [tab, setTab] = useState<ResTab>('body')
  const [view, setView] = useState<View>('pretty')
  const ct = res.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1]
  const info = useMemo(() => bodyInfo(res.body, ct), [res, ct])
  const isImage = info.kind === 'image'
  const isPdf = info.kind === 'pdf'
  const isText = info.kind === 'text'
  const toast = useStore((s) => s.showToast)
  // binário abre direto no Preview; texto volta para o Pretty
  useEffect(() => setView(isText ? 'pretty' : 'preview'), [isText, res])
  const text = useMemo(() => (isText ? decodeText(res.body, ct) : ''), [res, ct, isText])
  const lang = languageFromContentType(ct, text)
  const pretty = useMemo(
    () => (lang === 'json' && text.length <= PRETTY_LIMIT ? prettyJson(text) : text),
    [text, lang]
  )
  const cookies = useMemo(() => parseSetCookies(res.headers), [res])
  const blobUrl = useMemo(() => {
    if (!isImage && !isPdf) return null
    const copy = new Uint8Array(res.body)
    return URL.createObjectURL(new Blob([copy.buffer], { type: info.mime }))
  }, [res, isImage, isPdf, info.mime])
  useEffect(() => () => void (blobUrl && URL.revokeObjectURL(blobUrl)), [blobUrl])
  const [dims, setDims] = useState<string | null>(null)
  useEffect(() => setDims(null), [blobUrl])
  const saveFile = async () => {
    const disp = res.headers.find(([k]) => k.toLowerCase() === 'content-disposition')?.[1]
    let name = dispositionFilename(disp)
    if (!name) {
      let last = ''
      try {
        last = decodeURIComponent(new URL(res.url).pathname.split('/').pop() ?? '')
      } catch {
        /* URL inválida */
      }
      name = /\.[a-z0-9]{1,8}$/i.test(last) ? last : `response.${info.ext}`
    }
    try {
      const p = await api.invoke('response:saveFile', new Uint8Array(res.body), name)
      if (p) toast(`Resposta salva em ${p}`)
    } catch (e) {
      toast(`Não foi possível salvar: ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, 'bad')
    }
  }
  const kindLabel = isPdf ? 'PDF' : isImage ? `Image${dims ? ` · ${dims}` : ''}` : !isText ? 'Binary' : lang === 'plaintext' ? 'Text' : lang.toUpperCase()

  return (
    <div className="response-view">
      <div className="res-bar">
        <div className="res-tabs">
          {(
            [
              ['body', 'Body'],
              ['cookies', `Cookies${cookies.length ? ` (${cookies.length})` : ''}`],
              ['headers', `Headers (${res.headers.length})`],
              ['tests', testLabel(res.scripts)],
              ['console', `Console${entryLogCount(entry) ? ` (${entryLogCount(entry)})` : ''}`]
            ] as [ResTab, string][]
          ).map(([id, label]) => (
            <button key={id} className={`subtab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <StatusMeta res={res} />
      </div>

      {tab === 'body' && (
        <div className="res-body">
          <div className="res-toolbar">
            {(['pretty', 'raw', 'preview'] as View[]).map((v) => (
              <button key={v} className={`seg ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
            <span className="lang-tag">{kindLabel}</span>
            <div className="spacer" />
            <button className="icon-btn" title="Save response to file" onClick={saveFile}>
              <Icon name="import" size={14} />
            </button>
            {isText && (
              <button className="icon-btn" title="Copy response" onClick={() => navigator.clipboard.writeText(text)}>
                ⧉
              </button>
            )}
          </div>
          {!isText && view !== 'preview' ? (
            <div className="binary-note">
              <b>Conteúdo binário</b>
              <span>
                {info.mime} · {formatBytes(res.body.byteLength)}
              </span>
              <span className="muted">{isPdf || isImage ? 'Veja em Preview ou salve o arquivo.' : 'Salve o arquivo para abrir em outro programa.'}</span>
              <div className="binary-actions">
                {(isPdf || isImage) && (
                  <button className="btn small" onClick={() => setView('preview')}>
                    Preview
                  </button>
                )}
                <button className="btn small ghost" onClick={saveFile}>
                  Save response to file
                </button>
              </div>
            </div>
          ) : isImage && blobUrl ? (
            <div className="img-preview">
              <img
                src={blobUrl}
                alt="response"
                onLoad={(e) => setDims(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)}
              />
            </div>
          ) : isPdf && blobUrl ? (
            <iframe className="pdf-preview" title="PDF" src={blobUrl} />
          ) : !isText ? (
            <div className="binary-note">
              <b>Sem pré-visualização para {info.mime}</b>
              <span className="muted">{formatBytes(res.body.byteLength)}. Salve o arquivo para abrir em outro programa.</span>
              <div className="binary-actions">
                <button className="btn small" onClick={saveFile}>
                  Save response to file
                </button>
              </div>
            </div>
          ) : view === 'preview' ? (
            <iframe className="preview" sandbox="" srcDoc={lang === 'html' ? text : `<pre>${escapeHtml(text)}</pre>`} />
          ) : (
            <CodeEditor
              value={view === 'pretty' ? pretty : text}
              language={view === 'pretty' ? lang : 'plaintext'}
              readOnly
              wordWrap={view === 'raw'}
            />
          )}
        </div>
      )}

      {tab === 'headers' && (
        <div className="res-scroll">
          <table className="kv-table ro">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {res.headers.map(([k, v], i) => (
                <tr key={i}>
                  <td>{k}</td>
                  <td className="mono">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'cookies' && (
        <div className="res-scroll">
          {cookies.length === 0 ? (
            <div className="placeholder">No cookies received from the server</div>
          ) : (
            <table className="kv-table ro">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Value</th>
                  <th>Domain</th>
                  <th>Path</th>
                  <th>Expires</th>
                  <th>HttpOnly</th>
                  <th>Secure</th>
                </tr>
              </thead>
              <tbody>
                {cookies.map((c, i) => (
                  <tr key={i}>
                    <td>{c.name}</td>
                    <td className="mono">{c.value}</td>
                    <td>{c.domain ?? new URL(res.url).hostname}</td>
                    <td>{c.path ?? '/'}</td>
                    <td>{c.expires ?? 'Session'}</td>
                    <td>{c.httpOnly ? 'true' : 'false'}</td>
                    <td>{c.secure ? 'true' : 'false'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'tests' && (
        <div className="res-scroll">
          <TestResults report={res.scripts} />
        </div>
      )}

      {tab === 'console' && (
        <div className="console-list res-console">
          {entry ? <EntryConsole e={entry} /> : <div className="console-empty">Sem registro de console para este envio.</div>}
        </div>
      )}
    </div>
  )
}

function StatusMeta({ res }: { res: HttpResponse }) {
  const cls = res.status < 300 ? 'ok' : res.status < 400 ? 'redir' : 'bad'
  const t = res.timings
  return (
    <div className="status-meta">
      <span className={`status ${cls}`}>
        {res.status} {res.statusText}
      </span>
      <span className="meta hover-card">
        {formatMs(t.total)}
        <div className="card">
          <div className="card-title">Response Time</div>
          {(
            [
              ['DNS Lookup', t.dns],
              ['TCP Handshake', t.tcp],
              ['SSL Handshake', t.tls],
              ['Waiting (TTFB)', t.ttfb],
              ['Download', t.download]
            ] as [string, number][]
          ).map(([l, v]) => (
            <div key={l} className="card-row">
              <span>{l}</span>
              <span>{formatMs(v)}</span>
            </div>
          ))}
          <div className="card-row total">
            <span>Total</span>
            <span>{formatMs(t.total)}</span>
          </div>
          {res.reusedConnection && <div className="card-note">Conexão reaproveitada (keep-alive)</div>}
          {res.redirects > 0 && <div className="card-note">{res.redirects} redirect(s)</div>}
        </div>
      </span>
      <span className="meta hover-card">
        {formatBytes(res.headersSize + res.bodySize)}
        <div className="card">
          <div className="card-title">Response Size</div>
          <div className="card-row">
            <span>Headers</span>
            <span>{formatBytes(res.headersSize)}</span>
          </div>
          <div className="card-row">
            <span>Body</span>
            <span>{formatBytes(res.bodySize)}</span>
          </div>
          {res.body.byteLength !== res.bodySize && (
            <div className="card-row">
              <span>Uncompressed</span>
              <span>{formatBytes(res.body.byteLength)}</span>
            </div>
          )}
          <div className="card-title second">Request Size</div>
          <div className="card-row">
            <span>Body</span>
            <span>{formatBytes(res.request.bodySize)}</span>
          </div>
          {res.remoteAddress && <div className="card-note">Remote address: {res.remoteAddress}</div>}
        </div>
      </span>
    </div>
  )
}

interface Cookie {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: string
  httpOnly: boolean
  secure: boolean
}

function parseSetCookies(headers: [string, string][]): Cookie[] {
  return headers
    .filter(([k]) => k.toLowerCase() === 'set-cookie')
    .map(([, v]) => {
      const [pair, ...attrs] = v.split(';')
      const eq = pair.indexOf('=')
      const c: Cookie = {
        name: pair.slice(0, eq).trim(),
        value: pair.slice(eq + 1).trim(),
        httpOnly: false,
        secure: false
      }
      for (const a of attrs) {
        const [k, ...rest] = a.trim().split('=')
        const val = rest.join('=')
        switch (k.toLowerCase()) {
          case 'domain':
            c.domain = val
            break
          case 'path':
            c.path = val
            break
          case 'expires':
            c.expires = val
            break
          case 'max-age':
            c.expires ??= new Date(Date.now() + Number(val) * 1000).toUTCString()
            break
          case 'httponly':
            c.httpOnly = true
            break
          case 'secure':
            c.secure = true
            break
        }
      }
      return c
    })
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function testLabel(r: ScriptsReport | undefined): string {
  const c = testCounts(r)
  if (!r || (c.total === 0 && c.skipped === 0)) return r?.errors.length ? 'Test Results (erro)' : 'Test Results'
  return `Test Results (${c.passed}/${c.total})`
}
