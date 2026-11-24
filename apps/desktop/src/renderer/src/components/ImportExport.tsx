import { useEffect, useState } from 'react'
import type { ImportResult } from '@shared/types'
import { Icon } from '../icons'
import { api } from '../api'
import { useStore } from '../store'

/** Diálogo Import: arrastar arquivos, escolher arquivos ou colar JSON do Postman / comando cURL. */
export function ImportDialog() {
  const open = useStore((s) => s.importOpen)
  const close = useStore((s) => s.closeImport)
  const apply = useStore((s) => s.applyImport)
  const [text, setText] = useState('')
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<ImportResult[]>([])

  useEffect(() => {
    if (!open) return
    setText('')
    setResults([])
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const run = async (inputs: { name: string | null; text: string }[]) => {
    if (!inputs.length) return
    setBusy(true)
    try {
      const out: ImportResult[] = []
      for (const i of inputs) out.push(await api.invoke('import:text', i.text, i.name))
      await apply(out)
      setResults(out)
      // só cURL e tudo certo: a aba já abriu, fecha o diálogo
      if (out.every((r) => r.ok && r.kind === 'curl')) close()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal import-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Import</span>
          <button className="icon-btn" onClick={close}>
            <Icon name="close" size={12} />
          </button>
        </div>

        <textarea
          className="import-text"
          autoFocus
          spellCheck={false}
          placeholder={'Cole aqui um comando cURL ou o JSON de uma collection, environment ou globals do Postman'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && text.trim() && run([{ name: null, text }])}
        />

        <div
          className={`drop-zone ${over ? 'over' : ''}`}
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={async (e) => {
            e.preventDefault()
            setOver(false)
            const files = [...e.dataTransfer.files]
            run(await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))))
          }}
        >
          <Icon name="import" size={22} />
          <span>
            Arraste arquivos aqui ou{' '}
            <button className="link strong" onClick={async () => run(await api.invoke('import:pickFiles'))}>
              escolha arquivos
            </button>
          </span>
          <small>.postman_collection.json (v2.0 e v2.1), .postman_environment.json, .postman_globals.json</small>
        </div>

        {results.length > 0 && (
          <div className="import-results">
            {results.map((r, i) => (
              <div key={i} className={`import-row ${r.ok ? 'ok' : 'bad'}`}>
                <Icon name={r.ok ? 'check' : 'close'} size={13} />
                <span className="ir-name">{r.name}</span>
                <span className="ir-detail">
                  {!r.ok
                    ? r.error
                    : r.kind === 'collection'
                      ? `Collection "${r.collection.name}" (v${r.version}): ${r.requests} requisições em ${r.folders} pastas`
                      : r.kind === 'environment'
                        ? `Environment "${r.environment.name}": ${r.environment.values.length} variáveis`
                        : r.kind === 'globals'
                          ? `Globals: ${r.count} variáveis mescladas`
                          : `cURL aberto numa aba nova: ${r.doc.request.method} ${r.doc.request.url.raw}`}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="modal-foot">
          <span className="muted">Ctrl+Enter importa o texto colado</span>
          <div className="spacer" />
          <button className="btn ghost" onClick={close}>
            {results.length ? 'Close' : 'Cancel'}
          </button>
          <button className="btn primary" disabled={!text.trim() || busy} onClick={() => run([{ name: null, text }])}>
            Import
          </button>
        </div>
      </div>
    </div>
  )
}

/** Diálogo Export de collection: escolhe v2.1 (recomendado) ou v2.0. */
export function ExportDialog() {
  const id = useStore((s) => s.exportCollectionId)
  const col = useStore((s) => s.collections.find((c) => c.id === s.exportCollectionId))
  const close = useStore((s) => s.closeExport)
  const toast = useStore((s) => s.showToast)
  const [version, setVersion] = useState<'2.1' | '2.0'>('2.1')
  const [busy, setBusy] = useState(false)
  if (!id || !col) return null
  const go = async () => {
    setBusy(true)
    try {
      const path = await api.invoke('export:collection', id, version)
      if (path) {
        toast(`Collection exportada em ${path}`)
        close()
      }
    } catch (e) {
      toast(`Falha ao exportar: ${(e as Error).message}`, 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal export-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Export "{col.name}"</span>
          <button className="icon-btn" onClick={close}>
            <Icon name="close" size={12} />
          </button>
        </div>
        <label className="radio block">
          <input type="radio" checked={version === '2.1'} onChange={() => setVersion('2.1')} />
          Collection v2.1 <span className="muted">(recomendado)</span>
        </label>
        <label className="radio block">
          <input type="radio" checked={version === '2.0'} onChange={() => setVersion('2.0')} />
          Collection v2.0
        </label>
        <div className="modal-foot">
          <div className="spacer" />
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={go}>
            Export
          </button>
        </div>
      </div>
    </div>
  )
}

export function Toast() {
  const t = useStore((s) => s.toast)
  const hide = useStore((s) => s.hideToast)
  useEffect(() => {
    if (!t) return
    const h = setTimeout(hide, 5000)
    return () => clearTimeout(h)
  }, [t, hide])
  if (!t) return null
  return (
    <div className={`toast ${t.kind}`} onClick={hide}>
      {t.text}
    </div>
  )
}
