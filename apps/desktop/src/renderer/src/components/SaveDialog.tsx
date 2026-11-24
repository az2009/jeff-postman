import { useEffect, useMemo, useState } from 'react'
import type { TreeItem } from '@shared/types'
import { Icon } from '../icons'
import { useStore } from '../store'

interface Dest {
  collectionId: string
  parentId: string | null
  label: string
  depth: number
}

/** "Save request": escolhe nome e destino (collection ou pasta) para uma requisição nova. */
export function SaveDialog() {
  const tabKey = useStore((s) => s.saveDialogTabKey)
  const tab = useStore((s) => s.tabs.find((t) => t.key === s.saveDialogTabKey))
  const collections = useStore((s) => s.collections)
  const items = useStore((s) => s.items)
  const close = useStore((s) => s.closeSaveDialog)
  const saveAs = useStore((s) => s.saveActiveAs)
  const createCollection = useStore((s) => s.createCollection)

  const [name, setName] = useState('')
  const [dest, setDest] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!tab) return
    const raw = tab.doc.request.url.raw
    setName(tab.doc.name === 'Untitled Request' && raw ? raw : tab.doc.name)
    setDest(null)
  }, [tabKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const dests = useMemo(() => {
    const out: Dest[] = []
    for (const c of collections) {
      out.push({ collectionId: c.id, parentId: null, label: c.name, depth: 0 })
      const list = items[c.id] ?? []
      const walk = (parentId: string | null, depth: number) => {
        list
          .filter((i: TreeItem) => i.kind === 'folder' && i.parentId === parentId)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .forEach((f) => {
            out.push({ collectionId: c.id, parentId: f.id, label: f.name, depth })
            walk(f.id, depth + 1)
          })
      }
      walk(null, 1)
    }
    return out
  }, [collections, items])

  const keyOf = (d: Dest) => d.parentId ?? d.collectionId
  const chosen = dests.find((d) => keyOf(d) === dest) ?? null

  useEffect(() => {
    if (!tabKey) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tabKey, close])

  if (!tabKey || !tab) return null

  const submit = async () => {
    if (!chosen || saving) return
    setSaving(true)
    try {
      await saveAs(name, chosen.collectionId, chosen.parentId)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Save request</span>
          <button className="icon-btn" onClick={close}>
            <Icon name="close" size={12} />
          </button>
        </div>
        <label className="field">
          <span>Request name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>
        <div className="field">
          <span>Save to {chosen ? <b>{chosen.label}</b> : <em>select a collection or folder</em>}</span>
          <div className="dest-list">
            {dests.length === 0 && <div className="tree-hint">Nenhuma collection ainda.</div>}
            {dests.map((d) => (
              <div
                key={keyOf(d)}
                className={`row ${dest === keyOf(d) ? 'active' : ''}`}
                style={{ paddingLeft: 10 + d.depth * 16 }}
                onClick={() => setDest(keyOf(d))}
                onDoubleClick={() => (setDest(keyOf(d)), void 0)}
              >
                <span className="row-icon">
                  <Icon name={d.depth === 0 ? 'collections' : 'folder'} size={14} />
                </span>
                <span className="row-name">{d.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button className="link" onClick={() => createCollection()}>+ New Collection</button>
          <div className="spacer" />
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn primary" disabled={!chosen || !name.trim() || saving} onClick={submit}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
