import { useEffect, useMemo, useRef, useState } from 'react'
import { bodyInfo } from '@shared/binary'
import { formatBytes, formatMs } from '@shared/http'
import { Icon } from '../icons'
import { api } from '../api'
import { methodClass, useStore, type ConsoleEntry } from '../store'
import { decodeText, prettyJson } from '../format'

type Level = 'all' | 'log' | 'info' | 'warn' | 'error'
const BODY_LIMIT = 256 * 1024

/** Console no estilo do Postman: um item por envio, expansível, com os logs dos scripts em ordem. */
export function ConsolePanel() {
  const entries = useStore((s) => s.consoleEntries)
  const clear = useStore((s) => s.clearConsole)
  const toggle = useStore((s) => s.togglePanel)
  const toast = useStore((s) => s.showToast)
  const [height, setHeight] = useState(() => Number(localStorage.getItem('consoleHeight')) || 260)
  const [level, setLevel] = useState<Level>('all')
  const [q, setQ] = useState('')
  const [hideNet, setHideNet] = useState(false)
  const [raw, setRaw] = useState(false)
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const listRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    if (stick.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [entries.length])

  const term = q.trim().toLowerCase()
  const shown = useMemo(
    () =>
      entries
        .map((e) => ({
          e,
          logs: e.logs.filter((l) => (level === 'all' || l.level === level) && (!term || l.text.toLowerCase().includes(term)))
        }))
        .filter(({ e, logs }) => {
          if (logs.length) return true
          if (hideNet) return false
          if (level === 'error') return !!e.error || e.scriptErrors.length > 0 || (e.status ?? 0) >= 400
          if (level !== 'all') return false
          return !term || `${e.method} ${e.url} ${e.status ?? ''} ${e.error ?? ''}`.toLowerCase().includes(term)
        }),
    [entries, level, term, hideNet]
  )

  const exportText = async () => {
    const text = entries.map((e) => entryText(e, true)).join('\n\n')
    const p = await api.invoke('console:save', text)
    if (p) toast(`Console exportado em ${p}`)
  }

  return (
    <section className="bottom-panel" style={{ height }}>
      <div
        className="console-resize"
        onMouseDown={(e) => {
          e.preventDefault()
          const y0 = e.clientY
          const h0 = height
          const move = (ev: MouseEvent) => setHeight(Math.max(120, Math.min(window.innerHeight - 200, h0 + (y0 - ev.clientY))))
          const up = () => {
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', up)
            setHeight((h) => (localStorage.setItem('consoleHeight', String(h)), h))
          }
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
        }}
      />
      <div className="bottom-head">
        <span>Console</span>
        <div className="search small console-search">
          <Icon name="search" size={13} />
          <input placeholder="Search messages" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="console-level" value={level} onChange={(e) => setLevel(e.target.value as Level)}>
          <option value="all">All Logs</option>
          <option value="log">Log</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
        <label className="console-opt">
          <input type="checkbox" checked={hideNet} onChange={(e) => setHideNet(e.target.checked)} /> Hide network
        </label>
        <label className="console-opt">
          <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} /> Show raw log
        </label>
        <div className="spacer" />
        <span className="muted">{entries.length} envio(s)</span>
        <button className="link" onClick={exportText} disabled={!entries.length}>
          Export
        </button>
        <button className="link" onClick={clear}>
          Clear
        </button>
        <button className="icon-btn" onClick={() => toggle('console')} title="Fechar (Ctrl+Alt+C)">
          <Icon name="close" size={12} />
        </button>
      </div>
      <div
        className="console-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
        }}
      >
        {shown.length === 0 && (
          <div className="console-empty">{entries.length ? 'Nada com esse filtro.' : 'Nenhum log. As requisições e os console.log dos scripts aparecem aqui.'}</div>
        )}
        {shown.map(({ e, logs }) => (
          <div key={e.id} className="console-entry">
            {logs
              .filter((l) => l.event === 'prerequest')
              .map((l, i) => (
                <LogLine key={`p${i}`} l={l} />
              ))}
            {!hideNet && (level === 'all' || (level === 'error' && (!!e.error || (e.status ?? 0) >= 400))) && (
              <>
                <div className={`console-line req clickable ${e.error ? 'lv-error' : ''}`} onClick={() => setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}>
                  <span className={`row-caret ${open[e.id] ? 'open' : ''}`}>
                    <Icon name="chevron" size={11} />
                  </span>
                  <span className={`console-method ${methodClass(e.method as never)}`}>{e.method}</span>
                  <span className="console-url" title={e.url}>
                    {e.url}
                  </span>
                  <span className="spacer" />
                  {e.status !== null && <span className={`console-status ${e.status >= 400 ? 'bad' : ''}`}>{e.status}</span>}
                  {e.timeMs !== null && <span className="console-time">{e.timeMs} ms</span>}
                  {e.error && <span className="console-status bad">{e.error}</span>}
                  <span className="console-clock">{new Date(e.time).toLocaleTimeString('pt-BR')}</span>
                </div>
                {open[e.id] && (raw ? <pre className="console-raw">{entryText(e, false)}</pre> : <EntryDetail e={e} />)}
              </>
            )}
            {logs
              .filter((l) => l.event === 'test')
              .map((l, i) => (
                <LogLine key={`t${i}`} l={l} />
              ))}
            {(level === 'all' || level === 'error') &&
              e.scriptErrors.map((x, i) => (
                <div key={`x${i}`} className="console-line lv-error">
                  <span className="console-src">{x.source}</span>
                  {x.error}
                </div>
              ))}
          </div>
        ))}
      </div>
    </section>
  )
}

/** Quantas linhas de log e erro de script uma entrada tem (para o contador da aba Console). */
export function entryLogCount(e: ConsoleEntry | undefined): number {
  return e ? e.logs.length + e.scriptErrors.length : 0
}

/**
 * Uma entrada do console, sozinha: logs do pre-request, a linha da requisição (clique abre o detalhe),
 * logs do post-response e erros de script. Usada na aba Console da resposta e do Runner.
 */
export function EntryConsole({ e, emptyHint }: { e: ConsoleEntry; emptyHint?: string }) {
  const [open, setOpen] = useState(false)
  const pre = e.logs.filter((l) => l.event === 'prerequest')
  const post = e.logs.filter((l) => l.event === 'test')
  return (
    <div className="console-entry entry-console">
      {pre.length > 0 && <div className="entry-console-label">Pre-request</div>}
      {pre.map((l, i) => (
        <LogLine key={`p${i}`} l={l} />
      ))}
      <div className={`console-line req clickable ${e.error ? 'lv-error' : ''}`} onClick={() => setOpen((o) => !o)}>
        <span className={`row-caret ${open ? 'open' : ''}`}>
          <Icon name="chevron" size={11} />
        </span>
        <span className={`console-method ${methodClass(e.method as never)}`}>{e.method}</span>
        <span className="console-url" title={e.url}>
          {e.url}
        </span>
        <span className="spacer" />
        {e.status !== null && <span className={`console-status ${e.status >= 400 ? 'bad' : ''}`}>{e.status}</span>}
        {e.timeMs !== null && <span className="console-time">{e.timeMs} ms</span>}
        {e.error && <span className="console-status bad">{e.error}</span>}
        {e.time > 0 && <span className="console-clock">{new Date(e.time).toLocaleTimeString('pt-BR')}</span>}
      </div>
      {open && <EntryDetail e={e} />}
      {post.length > 0 && <div className="entry-console-label">Post-response</div>}
      {post.map((l, i) => (
        <LogLine key={`t${i}`} l={l} />
      ))}
      {e.scriptErrors.map((x, i) => (
        <div key={`x${i}`} className="console-line lv-error">
          <span className="console-src">{x.source}</span>
          {x.error}
        </div>
      ))}
      {pre.length + post.length + e.scriptErrors.length === 0 && (
        <div className="console-empty">{emptyHint ?? 'Nenhum console.log nos scripts desta requisição.'}</div>
      )}
    </div>
  )
}

function LogLine({ l }: { l: ConsoleEntry['logs'][number] }) {
  return (
    <div className={`console-line lv-${l.level}`}>
      <span className="console-src">{l.source}</span>
      <span className="console-text">{l.text}</span>
    </div>
  )
}

function EntryDetail({ e }: { e: ConsoleEntry }) {
  const res = e.response
  const reqHeaders = res?.request.headers ?? e.requestHeaders ?? []
  const reqBody = res?.request.bodyPreview ?? e.requestBody
  const ct = res?.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1]
  const body = res ? bodyText(res.body, ct) : null
  return (
    <div className="console-detail">
      {res && (
        <Section title="Network">
          <Kv k="Remote address" v={res.remoteAddress ?? '—'} />
          <Kv k="HTTP" v={`HTTP/${res.httpVersion}${res.reusedConnection ? ' (conexão reaproveitada)' : ''}`} />
          <Kv k="Tempo" v={`total ${formatMs(res.timings.total)} · DNS ${formatMs(res.timings.dns)} · TCP ${formatMs(res.timings.tcp)} · TLS ${formatMs(res.timings.tls)} · espera ${formatMs(res.timings.ttfb)} · download ${formatMs(res.timings.download)}`} />
          <Kv k="Tamanho" v={`headers ${formatBytes(res.headersSize)} · corpo ${formatBytes(res.bodySize)}${res.redirects ? ` · ${res.redirects} redirect(s)` : ''}`} />
        </Section>
      )}
      <Section title="Request Headers">
        {reqHeaders.map(([k, v], i) => (
          <Kv key={i} k={k} v={v} />
        ))}
      </Section>
      {reqBody && (
        <Section title="Request Body">
          <pre className="console-body">{reqBody}</pre>
        </Section>
      )}
      {res && (
        <>
          <Section title="Response Headers">
            {res.headers.map(([k, v], i) => (
              <Kv key={i} k={k} v={v} />
            ))}
          </Section>
          <Section title="Response Body">
            <pre className="console-body">{body}</pre>
          </Section>
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="console-sec">
      <div className="console-sec-title" onClick={() => setOpen((o) => !o)}>
        <span className={`row-caret ${open ? 'open' : ''}`}>
          <Icon name="chevron" size={10} />
        </span>
        {title}
      </div>
      {open && <div className="console-sec-body">{children}</div>}
    </div>
  )
}

const Kv = ({ k, v }: { k: string; v: string }) => (
  <div className="console-kv">
    <span className="ck">{k}:</span>
    <span className="cv">{v}</span>
  </div>
)

function bodyText(bytes: Uint8Array, ct: string | undefined): string {
  const info = bodyInfo(bytes, ct)
  if (info.kind !== 'text') return `[binário: ${info.mime}, ${bytes.byteLength} bytes]`
  const cut = bytes.byteLength > BODY_LIMIT
  const t = decodeText(cut ? bytes.subarray(0, BODY_LIMIT) : bytes, ct)
  const pretty = /json/i.test(ct ?? '') && !cut ? prettyJson(t) : t
  return cut ? `${pretty}\n… (${bytes.byteLength - BODY_LIMIT} bytes a mais)` : pretty
}

/** Texto do envio (Export e "Show raw log"). */
function entryText(e: ConsoleEntry, withLogs: boolean): string {
  const lines: string[] = []
  const logs = (ev: 'prerequest' | 'test') => (withLogs ? e.logs.filter((l) => l.event === ev).map((l) => `[${l.level}] ${l.source}: ${l.text}`) : [])
  lines.push(...logs('prerequest'))
  const stamp = new Date(e.time).toISOString()
  const res = e.response
  let path = e.url
  try {
    const u = new URL(e.url)
    path = u.pathname + u.search
  } catch {
    // URL inválida: mostra como está
  }
  if (withLogs) lines.push(`# ${stamp} ${e.method} ${e.url} → ${e.status ?? e.error} ${e.timeMs !== null ? `(${e.timeMs} ms)` : ''}`)
  lines.push(`${e.method} ${path} HTTP/1.1`)
  for (const [k, v] of res?.request.headers ?? e.requestHeaders ?? []) lines.push(`${k}: ${v}`)
  const rb = res?.request.bodyPreview ?? e.requestBody
  if (rb) lines.push('', rb)
  if (res) {
    lines.push('', `HTTP/${res.httpVersion} ${res.status} ${res.statusText}`)
    for (const [k, v] of res.headers) lines.push(`${k}: ${v}`)
    const ct = res.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1]
    lines.push('', bodyText(res.body, ct))
  } else if (e.error) lines.push('', `Erro: ${e.error}`)
  lines.push(...logs('test'))
  for (const x of e.scriptErrors) lines.push(`[error] ${x.source}: ${x.error}`)
  return lines.join('\n')
}
