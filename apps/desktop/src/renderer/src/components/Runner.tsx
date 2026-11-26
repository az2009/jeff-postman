import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import type { RunRequestResult, RunSummary } from '@shared/types'
import { formatBytes, formatMs } from '@shared/http'
import { api } from '../api'
import { Icon } from '../icons'
import { methodClass, useStore, type OpenTab } from '../store'
import { prettyJson } from '../format'
import { useResizableWidth } from '../resize'
import { CodeEditor } from './CodeEditor'
import { EntryConsole } from './ConsolePanel'
import type { ConsoleEntry } from '../store'

type OrderItem = { id: string; name: string; method: string; path: string; on: boolean }

/** Aba do Collection Runner: configuração e resultados. */
export function RunnerView({ tab }: { tab: OpenTab }) {
  const r = tab.runner!
  return r.runId && r.view === 'results' ? <RunResults tab={tab} /> : <RunConfigView tab={tab} />
}

function RunConfigView({ tab }: { tab: OpenTab }) {
  const r = tab.runner!
  const collections = useStore((s) => s.collections)
  const environments = useStore((s) => s.environments)
  const activeEnvId = useStore((s) => s.activeEnvId)
  const update = useStore((s) => s.updateRunnerTab)
  const startRun = useStore((s) => s.startRun)
  const toast = useStore((s) => s.showToast)
  const [order, setOrder] = useState<OrderItem[]>([])
  const [iterations, setIterations] = useState(1)
  const [delay, setDelay] = useState(0)
  const [envId, setEnvId] = useState<string | null>(activeEnvId)
  const [keep, setKeep] = useState(true)
  const [stopOnError, setStopOnError] = useState(false)
  const [saveResponses, setSaveResponses] = useState(true)
  const [data, setData] = useState<{ name: string; columns: string[]; rows: Record<string, string>[] } | null>(null)
  const [preview, setPreview] = useState(false)
  const [drag, setDrag] = useState<number | null>(null)
  const [past, setPast] = useState<RunSummary[]>([])
  const [busy, setBusy] = useState(false)
  const runsVersion = useStore((s) => s.runsVersion)

  useEffect(() => {
    if (!r.collectionId) return setOrder([])
    api.invoke('runner:order', r.collectionId, r.folderId).then((l) => setOrder(l.map((x) => ({ ...x, on: true }))))
  }, [r.collectionId, r.folderId])
  useEffect(() => {
    api.invoke('runner:list', r.collectionId).then(setPast)
  }, [r.collectionId, runsVersion])

  const selected = order.filter((o) => o.on)
  const run = async () => {
    if (!r.collectionId) return
    setBusy(true)
    try {
      await startRun(tab.key, {
        collectionId: r.collectionId,
        folderId: r.folderId,
        requestIds: selected.map((o) => o.id),
        iterations,
        delayMs: delay,
        data: data?.rows ?? null,
        dataFileName: data?.name ?? null,
        environmentId: envId,
        keepVariableValues: keep,
        stopOnError,
        saveResponses
      })
    } catch (e) {
      toast(`Não foi possível iniciar: ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="runner">
      <div className="runner-head">
        <Icon name="runner" size={18} />
        <span className="vars-title">Runner</span>
        <select
          className="runner-col"
          value={r.collectionId ?? ''}
          onChange={(e) => {
            const c = collections.find((x) => x.id === e.target.value)
            update({ collectionId: c?.id ?? null, folderId: null, name: c?.name ?? 'Runner' })
          }}
        >
          <option value="">Escolha a collection…</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {r.folderId && (
          <span className="chip">
            pasta: {r.name.split(' / ').pop()}
            <button onClick={() => update({ folderId: null, name: collections.find((c) => c.id === r.collectionId)?.name ?? '' })}>×</button>
          </span>
        )}
      </div>

      <div className="runner-body">
        <section className="runner-order">
          <div className="runner-sec-head">
            <b>Run order</b>
            <span className="muted">
              {selected.length}/{order.length}
            </span>
            <div className="spacer" />
            <button className="link" onClick={() => setOrder((o) => o.map((x) => ({ ...x, on: true })))}>
              Select all
            </button>
            <button className="link" onClick={() => setOrder((o) => o.map((x) => ({ ...x, on: false })))}>
              Deselect all
            </button>
          </div>
          {!r.collectionId && <div className="placeholder">Escolha uma collection acima.</div>}
          {r.collectionId && order.length === 0 && <div className="placeholder">Esta collection não tem requisições.</div>}
          <div className="runner-list">
            {order.map((o, i) => (
              <div
                key={o.id}
                className={`runner-item ${drag === i ? 'dragging' : ''}`}
                draggable
                onDragStart={() => setDrag(i)}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (drag === null || drag === i) return
                  setOrder((l) => {
                    const n = [...l]
                    const [m] = n.splice(drag, 1)
                    n.splice(i, 0, m)
                    return n
                  })
                  setDrag(i)
                }}
                onDragEnd={() => setDrag(null)}
              >
                <span className="grip">⋮⋮</span>
                <input type="checkbox" checked={o.on} onChange={(e) => setOrder((l) => l.map((x) => (x.id === o.id ? { ...x, on: e.target.checked } : x)))} />
                <span className={`row-method ${methodClass(o.method as never)}`}>{o.method === 'DELETE' ? 'DEL' : o.method}</span>
                <span className="runner-name">{o.name}</span>
                {o.path && <span className="runner-path">{o.path}</span>}
              </div>
            ))}
          </div>
        </section>

        <section className="runner-config">
          <div className="runner-sec-head">
            <b>Run configuration</b>
          </div>
          <label className="rc-field">
            <span>Iterations</span>
            <input type="number" min={1} max={100000} value={iterations} onChange={(e) => setIterations(Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <label className="rc-field">
            <span>Delay (ms)</span>
            <input type="number" min={0} max={600000} value={delay} onChange={(e) => setDelay(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <div className="rc-field">
            <span>Data</span>
            <div className="rc-data">
              <button
                className="btn small"
                onClick={async () => {
                  try {
                    const d = await api.invoke('runner:pickData')
                    if (!d) return
                    setData(d)
                    setIterations(Math.max(1, d.rows.length))
                  } catch (e) {
                    toast(`Data file inválido: ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, 'bad')
                  }
                }}
              >
                Select File
              </button>
              {data && (
                <>
                  <span className="file-chip" title={data.name}>
                    {data.name}
                    <button onClick={() => setData(null)}>×</button>
                  </span>
                  <button className="link" onClick={() => setPreview(true)}>
                    Preview ({data.rows.length} linhas)
                  </button>
                </>
              )}
            </div>
          </div>
          {data && <p className="muted rc-note">Cada linha é uma iteração; as colunas viram {'{{coluna}}'} e pm.iterationData.get("coluna").</p>}
          <label className="rc-field">
            <span>Environment</span>
            <select value={envId ?? ''} onChange={(e) => setEnvId(e.target.value || null)}>
              <option value="">No environment</option>
              {environments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label className="rc-check">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            Keep variable values <span className="muted">(grava no fim o que os scripts mudaram)</span>
          </label>
          <label className="rc-check">
            <input type="checkbox" checked={stopOnError} onChange={(e) => setStopOnError(e.target.checked)} />
            Stop run if an error occurs
          </label>
          <label className="rc-check">
            <input type="checkbox" checked={saveResponses} onChange={(e) => setSaveResponses(e.target.checked)} />
            Save responses <span className="muted">(guarda o corpo, até 64 KB por resposta, para ver ao clicar na requisição)</span>
          </label>
          <button className="btn primary run-btn" disabled={!r.collectionId || !selected.length || busy} onClick={run}>
            Run {r.name || 'collection'}
          </button>

          <div className="runner-sec-head past-head">
            <b>Execuções anteriores</b>
          </div>
          <div className="runner-past">
            {past.length === 0 && <div className="muted">Nenhuma ainda.</div>}
            {past.map((p) => (
              <div key={p.id} className="row past-row" onClick={() => update({ runId: p.id, view: 'results' })}>
                <span className={`tk-dot ${p.testsFailed || p.errors ? 'old' : ''}`} />
                <span className="row-name">
                  {new Date(p.startedAt).toLocaleString('pt-BR')} · {p.name}
                </span>
                <span className="muted">
                  {p.testsPassed}✓ {p.testsFailed}✗ · {formatMs(p.totalMs)}
                </span>
                <div className="row-menu">
                  <button
                    className="icon-btn"
                    title="Apagar"
                    onClick={async (e) => {
                      e.stopPropagation()
                      await api.invoke('runner:delete', p.id)
                      setPast((l) => l.filter((x) => x.id !== p.id))
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {preview && data && (
        <div className="modal-backdrop" onMouseDown={() => setPreview(false)}>
          <div className="modal data-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>
                {data.name} · {data.rows.length} linhas
              </span>
              <button className="icon-btn" onClick={() => setPreview(false)}>
                <Icon name="close" size={12} />
              </button>
            </div>
            <div className="data-table-wrap">
              <table className="kv-table ro">
                <thead>
                  <tr>
                    <th>#</th>
                    {data.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.slice(0, 200).map((row, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      {data.columns.map((c) => (
                        <td key={c}>{row[c]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.rows.length > 200 && <div className="muted">Mostrando 200 de {data.rows.length}.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RunResults({ tab }: { tab: OpenTab }) {
  const r = tab.runner!
  const live = useStore((s) => (r.runId ? s.runs[r.runId] : undefined))
  const loadRun = useStore((s) => s.loadRun)
  const update = useStore((s) => s.updateRunnerTab)
  const toast = useStore((s) => s.showToast)
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed'>('all')
  const [iter, setIter] = useState<number | 'all'>('all')
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const [sel, setSel] = useState<number | null>(null)
  const side = useResizableWidth('runDetailWidth', 520, 320, 0.7, 'right')

  useEffect(() => {
    if (r.runId && !live) loadRun(r.runId)
  }, [r.runId, live, loadRun])
  useEffect(() => setSel(null), [r.runId])

  const results = live?.results ?? []
  const s = live?.summary
  const failed = (x: RunRequestResult) => !!x.error || x.tests.some((t) => !t.passed && !t.skipped)
  const shown = useMemo(
    () =>
      results.filter(
        (x) => (iter === 'all' || x.iteration === iter) && (filter === 'all' || (filter === 'failed' ? failed(x) : !failed(x)))
      ),
    [results, filter, iter]
  )
  const selected = sel === null ? undefined : results.find((x) => x.seq === sel)
  if (!s) return <div className="placeholder pad">Carregando…</div>
  const running = s.status === 'running'
  const paused = running && !!s.paused
  const groups: [number, RunRequestResult[]][] = []
  for (const x of shown) {
    const g = groups[groups.length - 1]
    if (g && g[0] === x.iteration) g[1].push(x)
    else groups.push([x.iteration, [x]])
  }
  // setas para cima e para baixo trocam a requisição aberta no painel
  const onListKey = (e: React.KeyboardEvent) => {
    if (sel === null || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
    const i = shown.findIndex((x) => x.seq === sel)
    const n = shown[i + (e.key === 'ArrowDown' ? 1 : -1)]
    if (n) {
      e.preventDefault()
      setSel(n.seq)
      document.getElementById(`run-row-${n.seq}`)?.scrollIntoView({ block: 'nearest' })
    }
  }

  return (
    <div className="runner">
      <div className="runner-head">
        <Icon name="runner" size={18} />
        <span className="vars-title">{s.name}</span>
        <span className={`run-status st-${paused ? 'paused' : s.status}`}>
          {paused ? 'Pausada' : { running: 'Rodando…', finished: 'Concluída', stopped: 'Parada', error: 'Erro' }[s.status]}
        </span>
        <div className="spacer" />
        {running ? (
          <>
            <button
              className="btn small ghost"
              title={paused ? 'Continuar de onde parou' : 'Pausar depois da requisição em andamento'}
              onClick={() => api.invoke('runner:pause', s.id, !paused)}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button className="btn small" onClick={() => api.invoke('runner:stop', s.id)}>
              Stop
            </button>
          </>
        ) : (
          <>
            <button
              className="btn small ghost"
              onClick={async () => {
                const p = await api.invoke('runner:export', s.id)
                if (p) toast(`Resultado exportado em ${p}`)
              }}
            >
              Export Results
            </button>
            <button className="btn small" onClick={() => update({ view: 'config', runId: null })}>
              New Run
            </button>
          </>
        )}
      </div>
      <div className="run-meta muted">
        {new Date(s.startedAt).toLocaleString('pt-BR')} · Environment: {s.environmentName ?? 'nenhum'} · Data: {s.dataFileName ?? 'nenhum'} · {s.iterations} iteração(ões)
        {s.message ? ` · ${s.message}` : ''}
      </div>
      <div className="run-cards">
        <Card label="Executadas" value={String(s.executed)} />
        <Card label="Duração" value={formatMs(s.totalMs)} />
        <Card label="Testes aprovados" value={String(s.testsPassed)} cls="ok" />
        <Card label="Testes reprovados" value={String(s.testsFailed)} cls={s.testsFailed ? 'bad' : ''} />
        <Card label="Erros" value={String(s.errors)} cls={s.errors ? 'bad' : ''} />
        <Card label="Tempo médio" value={`${s.avgMs} ms`} />
      </div>
      {running && (
        <div className={`run-progress ${paused ? 'paused' : ''}`}>
          <div style={{ width: `${Math.min(100, (s.executed / Math.max(1, (tab.runner!.total ?? s.executed) || 1)) * 100)}%` }} />
        </div>
      )}
      <div className="tr-filters run-filters">
        {(['all', 'passed', 'failed'] as const).map((f) => (
          <button key={f} className={`seg ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'passed' ? 'Passed' : 'Failed'}
          </button>
        ))}
        <select value={iter} onChange={(e) => setIter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">Todas as iterações</option>
          {Array.from({ length: s.iterations }, (_, i) => (
            <option key={i} value={i}>
              Iteração {i + 1}
            </option>
          ))}
        </select>
      </div>
      <div className="run-split">
        <div className="run-list" tabIndex={0} onKeyDown={onListKey}>
          {groups.map(([it, rows]) => (
            <div key={it}>
              <div className="group-label">Iteração {it + 1}</div>
              {rows.map((x) => {
                const pass = x.tests.filter((t) => t.passed).length
                const fail = x.tests.filter((t) => !t.passed && !t.skipped).length
                return (
                  <div key={x.seq} className="run-row-wrap">
                    <div
                      id={`run-row-${x.seq}`}
                      className={`run-row ${failed(x) ? 'bad' : ''} ${sel === x.seq ? 'selected' : ''}`}
                      onClick={() => setSel(x.seq)}
                    >
                      <span
                        className={`row-caret ${open[x.seq] ? 'open' : ''}`}
                        title="Mostrar os testes aqui"
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpen((o) => ({ ...o, [x.seq]: !o[x.seq] }))
                        }}
                      >
                        <Icon name="chevron" size={11} />
                      </span>
                      <span className={`row-method ${methodClass(x.method as never)}`}>{x.method === 'DELETE' ? 'DEL' : x.method}</span>
                      <span className="runner-name">{x.name}</span>
                      <span className="runner-path" title={x.url}>
                        {x.url}
                      </span>
                      <span className="spacer" />
                      {x.skipped ? (
                        <span className="muted">pulada</span>
                      ) : x.status !== null ? (
                        <span className={`console-status ${x.status >= 400 ? 'bad' : ''}`}>
                          {x.status} {x.statusText}
                        </span>
                      ) : null}
                      {x.status !== null && (
                        <span className="muted">
                          {x.timeMs} ms · {formatBytes(x.size)}
                        </span>
                      )}
                      {(pass > 0 || fail > 0) && (
                        <span className="run-tests">
                          <span className="ok">{pass}✓</span> <span className={fail ? 'bad' : 'muted'}>{fail}✗</span>
                        </span>
                      )}
                    </div>
                    {x.error && <div className="run-err mono">{x.error}</div>}
                    {open[x.seq] && (
                      <div className="run-detail">
                        <TestList tests={x.tests} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
          {shown.length === 0 && (
            <div className="placeholder pad">{running ? (paused ? 'Pausada.' : 'Aguardando resultados…') : 'Nada com esse filtro.'}</div>
          )}
        </div>
        {selected && (
          <>
            <div className="col-resizer" title="Arraste para ajustar a largura (duplo clique volta ao padrão)" onMouseDown={side.onMouseDown} onDoubleClick={side.reset} />
            <aside className="run-side" style={{ width: side.width }}>
              <RunDetail key={selected.seq} x={selected} onClose={() => setSel(null)} />
            </aside>
          </>
        )}
      </div>
    </div>
  )
}

function TestList({ tests }: { tests: RunRequestResult['tests'] }) {
  if (tests.length === 0) return <div className="muted">Sem testes.</div>
  return (
    <>
      {tests.map((t, i) => (
        <div key={i} className="tr-row">
          <span className={`tr-badge ${t.skipped ? 'skip' : t.passed ? 'ok' : 'bad'}`}>{t.skipped ? 'SKIPPED' : t.passed ? 'PASS' : 'FAIL'}</span>
          <div className="tr-text">
            <span>{t.name}</span>
            {t.error && <span className="tr-err mono">{t.error}</span>}
          </div>
        </div>
      ))}
    </>
  )
}

/** Resultado do Runner no formato de entrada do console (só a requisição; o corpo da resposta fica na aba Response). */
function consoleEntryOf(x: RunRequestResult): ConsoleEntry {
  return {
    id: x.seq,
    time: x.at ?? 0,
    method: x.method,
    url: x.url,
    status: x.status,
    timeMs: x.status !== null ? x.timeMs : null,
    error: x.error,
    logs: x.logs ?? [],
    scriptErrors: x.scriptErrors ?? [],
    response: null,
    requestHeaders: x.requestHeaders,
    requestBody: x.requestBody
  }
}

function bodyLanguage(headers: [string, string][] | undefined, body: string): string {
  const ct = headers?.find(([k]) => k.toLowerCase() === 'content-type')?.[1].toLowerCase() ?? ''
  const t = body.trimStart()
  if (ct.includes('json') || t.startsWith('{') || t.startsWith('[')) return 'json'
  if (ct.includes('html')) return 'html'
  if (ct.includes('xml') || t.startsWith('<')) return 'xml'
  return 'plaintext'
}

/** Painel da direita: a requisição enviada e a resposta recebida, como no Runner do Postman. */
function RunDetail({ x, onClose }: { x: RunRequestResult; onClose(): void }) {
  const [tab, setTab] = useState<'response' | 'request' | 'tests' | 'console'>(x.status === null ? 'request' : 'response')
  const [sub, setSub] = useState<'body' | 'headers'>('body')
  const pass = x.tests.filter((t) => t.passed).length
  const logCount = (x.logs?.length ?? 0) + (x.scriptErrors?.length ?? 0)
  const headers = tab === 'request' ? x.requestHeaders : x.responseHeaders
  const rawBody = tab === 'request' ? x.requestBody : x.responseBody
  const body = rawBody === undefined ? undefined : prettyJson(rawBody)
  const lang = body === undefined ? 'plaintext' : bodyLanguage(headers, body)

  return (
    <div className="run-detail-pane">
      <div className="rdp-head">
        <span className={`row-method ${methodClass(x.method as never)}`}>{x.method === 'DELETE' ? 'DEL' : x.method}</span>
        <span className="rdp-title" title={x.name}>
          {x.name}
        </span>
        <span className="muted">Iteração {x.iteration + 1}</span>
        <button className="icon-btn" title="Fechar" onClick={onClose}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="rdp-url mono" title={x.url}>
        {x.url}
      </div>
      <div className="rdp-status">
        {x.status !== null ? (
          <>
            <span className={`console-status ${x.status >= 400 ? 'bad' : ''}`}>
              {x.status} {x.statusText}
            </span>
            <span className="muted">
              {x.timeMs} ms · {formatBytes(x.size)}
              {x.httpVersion ? ` · HTTP/${x.httpVersion}` : ''}
            </span>
          </>
        ) : x.skipped ? (
          <span className="muted">Requisição pulada (pm.execution.skipRequest).</span>
        ) : (
          <span className="rdp-error mono">{x.error ?? 'Sem resposta.'}</span>
        )}
      </div>
      <div className="rdp-tabs">
        {(['response', 'request', 'tests', 'console'] as const).map((t) => (
          <button key={t} className={`rdp-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'response'
              ? 'Response'
              : t === 'request'
                ? 'Request'
                : t === 'tests'
                  ? `Tests (${pass}/${x.tests.length})`
                  : `Console${logCount ? ` (${logCount})` : ''}`}
          </button>
        ))}
        <div className="spacer" />
        {(tab === 'response' || tab === 'request') && (
          <>
            <button className={`seg ${sub === 'body' ? 'active' : ''}`} onClick={() => setSub('body')}>
              Body
            </button>
            <button className={`seg ${sub === 'headers' ? 'active' : ''}`} onClick={() => setSub('headers')}>
              Headers{headers ? ` (${headers.length})` : ''}
            </button>
          </>
        )}
      </div>
      <div className="rdp-body">
        {tab === 'tests' ? (
          <div className="rdp-tests">
            <TestList tests={x.tests} />
          </div>
        ) : tab === 'console' ? (
          <div className="console-list rdp-console">
            <EntryConsole
              e={consoleEntryOf(x)}
              emptyHint={x.logs || x.scriptErrors || x.at ? undefined : 'Sem logs registrados nesta execução (feita antes do Console no Runner).'}
            />
            {x.logsTruncated && <div className="console-empty">Logs cortados: o Runner guarda até 200 linhas e 32 KB por requisição.</div>}
          </div>
        ) : sub === 'headers' ? (
          headers && headers.length ? (
            <table className="kv-table ro rdp-headers">
              <tbody>
                {headers.map(([k, v], i) => (
                  <tr key={i}>
                    <td>{k}</td>
                    <td className="mono">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="placeholder pad">{tab === 'response' && x.status === null ? 'Não houve resposta.' : 'Sem headers registrados.'}</div>
          )
        ) : body !== undefined && body !== '' ? (
          <CodeEditor value={body} language={lang} readOnly wordWrap />
        ) : (
          <div className="placeholder pad">
            {tab === 'response' && x.responseBinary
              ? `Conteúdo binário (${x.responseBinary.mime}, ${formatBytes(x.responseBinary.size)}): o Runner não guarda arquivos. Para ver, abra a requisição e envie de novo.`
              : tab === 'request'
              ? 'A requisição não teve corpo.'
              : x.status === null
                ? 'Não houve resposta.'
                : 'O corpo da resposta não foi guardado. Marque "Save responses" na configuração da execução.'}
          </div>
        )}
      </div>
    </div>
  )
}

function Card({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="run-card">
      <span className="muted">{label}</span>
      <b className={cls}>{value}</b>
    </div>
  )
}
