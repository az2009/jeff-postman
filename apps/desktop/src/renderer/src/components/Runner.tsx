import { useEffect, useMemo, useState } from 'react'
import type { RunRequestResult, RunSummary } from '@shared/types'
import { formatBytes, formatMs } from '@shared/http'
import { api } from '../api'
import { Icon } from '../icons'
import { methodClass, useStore, type OpenTab } from '../store'

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
  const [saveResponses, setSaveResponses] = useState(false)
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
            Save responses <span className="muted">(até 64 KB por resposta)</span>
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

  useEffect(() => {
    if (r.runId && !live) loadRun(r.runId)
  }, [r.runId, live, loadRun])

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
  if (!s) return <div className="placeholder pad">Carregando…</div>
  const running = s.status === 'running'
  const groups: [number, RunRequestResult[]][] = []
  for (const x of shown) {
    const g = groups[groups.length - 1]
    if (g && g[0] === x.iteration) g[1].push(x)
    else groups.push([x.iteration, [x]])
  }

  return (
    <div className="runner">
      <div className="runner-head">
        <Icon name="runner" size={18} />
        <span className="vars-title">{s.name}</span>
        <span className={`run-status st-${s.status}`}>{{ running: 'Rodando…', finished: 'Concluída', stopped: 'Parada', error: 'Erro' }[s.status]}</span>
        <div className="spacer" />
        {running ? (
          <button className="btn small" onClick={() => api.invoke('runner:stop', s.id)}>
            Stop
          </button>
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
      {running && <div className="run-progress"><div style={{ width: `${Math.min(100, (s.executed / Math.max(1, (tab.runner!.total ?? s.executed) || 1)) * 100)}%` }} /></div>}
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
      <div className="run-list">
        {groups.map(([it, rows]) => (
          <div key={it}>
            <div className="group-label">Iteração {it + 1}</div>
            {rows.map((x) => {
              const pass = x.tests.filter((t) => t.passed).length
              const fail = x.tests.filter((t) => !t.passed && !t.skipped).length
              return (
                <div key={x.seq} className="run-row-wrap">
                  <div className={`run-row ${failed(x) ? 'bad' : ''}`} onClick={() => setOpen((o) => ({ ...o, [x.seq]: !o[x.seq] }))}>
                    <span className={`row-caret ${open[x.seq] ? 'open' : ''}`}>
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
                    {x.status !== null && <span className="muted">{x.timeMs} ms · {formatBytes(x.size)}</span>}
                    {(pass > 0 || fail > 0) && (
                      <span className="run-tests">
                        <span className="ok">{pass}✓</span> <span className={fail ? 'bad' : 'muted'}>{fail}✗</span>
                      </span>
                    )}
                  </div>
                  {x.error && <div className="run-err mono">{x.error}</div>}
                  {open[x.seq] && (
                    <div className="run-detail">
                      {x.tests.length === 0 && <div className="muted">Sem testes.</div>}
                      {x.tests.map((t, i) => (
                        <div key={i} className="tr-row">
                          <span className={`tr-badge ${t.skipped ? 'skip' : t.passed ? 'ok' : 'bad'}`}>{t.skipped ? 'SKIPPED' : t.passed ? 'PASS' : 'FAIL'}</span>
                          <div className="tr-text">
                            <span>{t.name}</span>
                            {t.error && <span className="tr-err mono">{t.error}</span>}
                          </div>
                        </div>
                      ))}
                      {x.responseBody !== undefined && <pre className="console-body">{x.responseBody}</pre>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
        {shown.length === 0 && <div className="placeholder pad">{running ? 'Aguardando resultados…' : 'Nada com esse filtro.'}</div>}
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
