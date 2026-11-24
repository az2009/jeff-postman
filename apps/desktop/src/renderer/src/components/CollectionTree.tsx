import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Collection, TreeItem } from '@shared/types'
import { Icon } from '../icons'
import { methodClass, useStore } from '../store'

const ROW_H = 28

type Row =
  | { kind: 'collection'; key: string; col: Collection; depth: 0; expanded: boolean }
  | { kind: 'item'; key: string; item: TreeItem; depth: number; expanded: boolean }
  | { kind: 'hint'; key: string; depth: number; text: string }

type DropPos = 'before' | 'after' | 'inside'

interface MenuEntry {
  label: string
  run?(): unknown
  danger?: boolean
  disabled?: boolean
}

type ChildMap = Map<string | null, TreeItem[]>

export function CollectionTree() {
  const collections = useStore((s) => s.collections)
  const items = useStore((s) => s.items)
  const expanded = useStore((s) => s.expanded)
  const activeItemId = useStore((s) => s.tabs.find((t) => t.key === s.activeTabKey)?.itemId ?? null)
  const st = useStore.getState

  const [q, setQ] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null)
  const [drag, setDrag] = useState<TreeItem | null>(null)
  const [drop, setDrop] = useState<{ key: string; pos: DropPos } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // filhos por pai, por collection, ordenados
  const children = useMemo(() => {
    const out: Record<string, ChildMap> = {}
    for (const [cid, list] of Object.entries(items)) {
      const m: ChildMap = new Map()
      for (const it of list) {
        const arr = m.get(it.parentId) ?? []
        arr.push(it)
        m.set(it.parentId, arr)
      }
      for (const arr of m.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder)
      out[cid] = m
    }
    return out
  }, [items])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    const out: Row[] = []
    for (const col of collections) {
      const m = children[col.id] ?? new Map()
      let visible: Set<string> | null = null // null = tudo
      const forced = new Set<string>()
      if (term) {
        const colMatch = col.name.toLowerCase().includes(term)
        const list = items[col.id] ?? []
        const byId = new Map(list.map((i) => [i.id, i]))
        const hits = list.filter((i) => i.name.toLowerCase().includes(term))
        if (!colMatch && hits.length === 0) continue
        if (!colMatch || hits.length) {
          visible = new Set()
          for (const h of hits) {
            visible.add(h.id)
            let p = h.parentId
            while (p) {
              visible.add(p)
              forced.add(p)
              p = byId.get(p)?.parentId ?? null
            }
          }
          if (hits.length) forced.add(col.id)
          if (colMatch && !hits.length) visible = null
        }
      }
      const colOpen = forced.has(col.id) || !!expanded[col.id]
      out.push({ kind: 'collection', key: col.id, col, depth: 0, expanded: colOpen })
      if (!colOpen) continue
      const walk = (parentId: string | null, depth: number) => {
        const kids = (m.get(parentId) ?? []).filter((k) => !visible || visible.has(k.id))
        if (kids.length === 0 && parentId === null && !term)
          out.push({ kind: 'hint', key: `${col.id}:empty`, depth, text: 'This collection is empty. Add a request to start.' })
        if (kids.length === 0 && parentId !== null && !term)
          out.push({ kind: 'hint', key: `${parentId}:empty`, depth, text: 'This folder is empty.' })
        for (const k of kids) {
          const open = k.kind === 'folder' && (forced.has(k.id) || !!expanded[k.id])
          out.push({ kind: 'item', key: k.id, item: k, depth, expanded: open })
          if (open) walk(k.id, depth + 1)
        }
      }
      walk(null, 1)
    }
    return out
  }, [collections, children, items, expanded, q])

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 15
  })

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  // ---------- menus ----------
  const entriesFor = (row: Row): MenuEntry[] => {
    if (row.kind === 'collection') {
      const id = row.col.id
      return [
        { label: 'Add request', run: () => st().createItem(id, null, 'request') },
        { label: 'Add folder', run: () => st().createItem(id, null, 'folder') },
        { label: 'Rename', run: () => setRenaming(id) },
        { label: 'Edit variables', run: () => st().openVariables({ type: 'collection', id }) },
        { label: 'Duplicate', run: () => st().duplicateCollection(id) },
        { label: 'Run collection (fase 8)', disabled: true },
        { label: 'Export', run: () => st().openExport(id) },
        { label: 'Delete', danger: true, run: () => confirm(`Apagar a collection "${row.col.name}" e tudo dentro dela?`) && st().deleteCollection(id) }
      ]
    }
    if (row.kind !== 'item') return []
    const it = row.item
    const common: MenuEntry[] = [
      { label: 'Rename', run: () => setRenaming(it.id) },
      { label: 'Duplicate', run: () => st().duplicateItem(it) },
      {
        label: 'Delete',
        danger: true,
        run: () => confirm(it.kind === 'folder' ? `Apagar a pasta "${it.name}" e tudo dentro dela?` : `Apagar "${it.name}"?`) && st().deleteItem(it)
      }
    ]
    return it.kind === 'folder'
      ? [
          { label: 'Add request', run: () => st().createItem(it.collectionId, it.id, 'request') },
          { label: 'Add folder', run: () => st().createItem(it.collectionId, it.id, 'folder') },
          ...common
        ]
      : [{ label: 'Open in tab', run: () => st().openItem(it) }, ...common]
  }

  const openMenu = (x: number, y: number, row: Row) => setMenu({ x, y, entries: entriesFor(row) })

  // ---------- arrastar e soltar ----------
  const isInside = (folderId: string, target: TreeItem): boolean => {
    // target está dentro (ou é) da pasta folderId?
    const list = items[target.collectionId] ?? []
    const byId = new Map(list.map((i) => [i.id, i]))
    let cur: string | null = target.id
    while (cur) {
      if (cur === folderId) return true
      cur = byId.get(cur)?.parentId ?? null
    }
    return false
  }

  const posFor = (e: DragEvent<HTMLDivElement>, row: Row): DropPos | null => {
    if (!drag) return null
    if (row.kind === 'collection') return 'inside'
    if (row.kind !== 'item') return null
    const it = row.item
    if (it.id === drag.id) return null
    if (drag.kind === 'folder' && drag.collectionId === it.collectionId && isInside(drag.id, it)) return null
    const r = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    if (it.kind === 'folder') return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside'
    return y < 0.5 ? 'before' : 'after'
  }

  const doDrop = (row: Row, pos: DropPos) => {
    if (!drag) return
    if (row.kind === 'collection') return st().moveItem(drag, row.col.id, null, null)
    if (row.kind !== 'item') return
    const it = row.item
    if (pos === 'inside') return st().moveItem(drag, it.collectionId, it.id, null)
    if (pos === 'before') return st().moveItem(drag, it.collectionId, it.parentId, it.id)
    const sibs = (children[it.collectionId]?.get(it.parentId) ?? []).filter((s) => s.id !== drag.id)
    const next = sibs[sibs.indexOf(it) + 1]
    return st().moveItem(drag, it.collectionId, it.parentId, next?.id ?? null)
  }

  const term = q.trim().toLowerCase()

  return (
    <>
      <div className="panel-head">
        <button className="icon-btn" title="New Collection" onClick={() => st().createCollection()}>
          <Icon name="plus" />
        </button>
        <div className="search">
          <Icon name="search" size={14} />
          <input placeholder="Search collections" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && (
            <button className="icon-btn tiny" onClick={() => setQ('')} title="Limpar">
              <Icon name="close" size={10} />
            </button>
          )}
        </div>
      </div>

      <div className="tree" ref={scrollRef} onScroll={() => menu && setMenu(null)}>
        {collections.length === 0 && (
          <div className="empty">
            <p>Crie uma collection para organizar suas requisições.</p>
            <button className="btn" onClick={() => st().createCollection()}>Create Collection</button>
          </div>
        )}
        {collections.length > 0 && rows.length === 0 && term && <div className="empty">Nada encontrado para "{q}".</div>}

        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((vi) => {
            const row = rows[vi.index]
            const style: CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, height: ROW_H, transform: `translateY(${vi.start}px)` }
            if (row.kind === 'hint')
              return (
                <div key={row.key} className="tree-hint" style={{ ...style, paddingLeft: 26 + row.depth * 14 }}>
                  {row.text}
                </div>
              )
            const id = row.kind === 'collection' ? row.col.id : row.item.id
            const name = row.kind === 'collection' ? row.col.name : row.item.name
            const isFolderish = row.kind === 'collection' || row.item.kind === 'folder'
            const dropCls = drop?.key === row.key ? `drop-${drop.pos}` : ''
            return (
              <div
                key={row.key}
                style={{ ...style, paddingLeft: 8 + row.depth * 14 }}
                className={`row ${row.kind === 'item' && row.item.id === activeItemId ? 'active' : ''} ${dropCls} ${drag?.id === id ? 'dragging' : ''}`}
                draggable={row.kind === 'item' && renaming !== id}
                onDragStart={(e) => {
                  if (row.kind !== 'item') return
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', row.item.id)
                  setDrag(row.item)
                }}
                onDragEnd={() => (setDrag(null), setDrop(null))}
                onDragOver={(e) => {
                  const pos = posFor(e, row)
                  if (!pos) return setDrop(null)
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (drop?.key !== row.key || drop.pos !== pos) setDrop({ key: row.key, pos })
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop((d) => (d?.key === row.key ? null : d))
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const pos = posFor(e, row)
                  if (pos) doDrop(row, pos)
                  setDrag(null)
                  setDrop(null)
                }}
                onClick={() => {
                  if (renaming === id) return
                  if (isFolderish) st().toggleExpanded(id)
                  else if (row.kind === 'item') st().openItem(row.item)
                }}
                onDoubleClick={() => isFolderish || setRenaming(id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  openMenu(e.clientX, e.clientY, row)
                }}
              >
                <span className={`row-caret ${row.expanded ? 'open' : ''}`}>{isFolderish && <Icon name="chevron" size={12} />}</span>
                {row.kind === 'item' &&
                  (row.item.kind === 'folder' ? (
                    <span className="row-icon">
                      <Icon name="folder" size={14} />
                    </span>
                  ) : (
                    <span className={`row-method ${methodClass(row.item.method)}`}>{methodLabel(row.item.method)}</span>
                  ))}
                {renaming === id ? (
                  <InlineRename
                    value={name}
                    onDone={(v) => {
                      setRenaming(null)
                      if (!v || v === name) return
                      if (row.kind === 'collection') st().renameCollection(id, v)
                      else st().renameItem(row.item, v)
                    }}
                  />
                ) : (
                  <span className="row-name">
                    <Highlight text={name} term={term} />
                  </span>
                )}
                <div className="row-menu" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="icon-btn"
                    title="View more actions"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect()
                      openMenu(r.right - 170, r.bottom + 2, row)
                    }}
                  >
                    <Icon name="dots" size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {menu && (
        <div
          className="menu floating"
          style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - menu.entries.length * 30 - 16) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {menu.entries.map((m) => (
            <button
              key={m.label}
              className={m.danger ? 'danger' : ''}
              disabled={m.disabled}
              onClick={() => {
                setMenu(null)
                m.run?.()
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

export const methodLabel = (m: string | null) => (m === 'DELETE' ? 'DEL' : m === 'OPTIONS' ? 'OPT' : (m ?? 'GET'))

function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>
  const i = text.toLowerCase().indexOf(term)
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </>
  )
}

function InlineRename({ value, onDone }: { value: string; onDone(v: string): void }) {
  const done = useRef(false)
  const finish = (v: string) => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  return (
    <input
      className="inline-rename"
      autoFocus
      defaultValue={value}
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.target.value.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish((e.target as HTMLInputElement).value.trim())
        if (e.key === 'Escape') finish('')
      }}
    />
  )
}
