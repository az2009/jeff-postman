import { useState } from 'react'
import { CollectionTree, methodLabel } from './CollectionTree'
import { api } from '../api'
import { Icon } from '../icons'
import { methodClass, useStore, type SidebarView } from '../store'

const RAIL: { id: SidebarView; label: string }[] = [
  { id: 'collections', label: 'Collections' },
  { id: 'environments', label: 'Environments' },
  { id: 'history', label: 'History' }
]

export function Sidebar() {
  const view = useStore((s) => s.sidebarView)
  const setView = useStore((s) => s.setSidebarView)
  return (
    <aside className="sidebar">
      <nav className="rail">
        {RAIL.map((r) => (
          <button key={r.id} className={`rail-btn ${view === r.id ? 'active' : ''}`} onClick={() => setView(r.id)}>
            <Icon name={r.id} size={18} />
            <span>{r.label}</span>
          </button>
        ))}
      </nav>
      <div className="panel">
        {view === 'collections' && <CollectionTree />}
        {view === 'environments' && <EnvironmentsPanel />}
        {view === 'history' && <HistoryPanel />}
      </div>
    </aside>
  )
}

function PanelHeader({ onAdd, title }: { onAdd(): void; title: string }) {
  const [q, setQ] = useState('')
  return (
    <div className="panel-head">
      <button className="icon-btn" title={`New ${title}`} onClick={onAdd}>
        <Icon name="plus" />
      </button>
      <div className="search">
        <Icon name="search" size={14} />
        <input placeholder={`Search ${title.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
    </div>
  )
}

function EnvironmentsPanel() {
  const envs = useStore((s) => s.environments)
  const create = useStore((s) => s.createEnvironment)
  const activeEnvId = useStore((s) => s.activeEnvId)
  const setActive = useStore((s) => s.setActiveEnv)
  const open = useStore((s) => s.openVariables)
  const duplicate = useStore((s) => s.duplicateEnvironment)
  const remove = useStore((s) => s.deleteEnvironment)
  const openKey = useStore((s) => {
    const t = s.tabs.find((x) => x.key === s.activeTabKey)
    return t?.vars ? (t.vars.scope.type === 'globals' ? 'globals' : t.vars.scope.type === 'environment' ? t.vars.scope.id : null) : null
  })
  const [q, setQ] = useState('')
  const shown = q ? envs.filter((e) => e.name.toLowerCase().includes(q.toLowerCase())) : envs
  return (
    <>
      <div className="panel-head">
        <button className="icon-btn" title="New Environment" onClick={() => create()}>
          <Icon name="plus" />
        </button>
        <div className="search">
          <Icon name="search" size={14} />
          <input placeholder="Search environments" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="tree">
        <div className={`row ${openKey === 'globals' ? 'active' : ''}`} style={{ paddingLeft: 12 }} onClick={() => open({ type: 'globals' })}>
          <span className="row-icon">
            <Icon name="globe" size={14} />
          </span>
          <span className="row-name">Globals</span>
        </div>
        <div className="group-label">Environments</div>
        {envs.length === 0 && <div className="tree-hint">Nenhum environment. Clique em + para criar.</div>}
        {shown.map((e) => (
          <div
            key={e.id}
            className={`row env-row ${openKey === e.id ? 'active' : ''}`}
            style={{ paddingLeft: 12 }}
            onClick={() => open({ type: 'environment', id: e.id })}
          >
            <button
              className={`env-check ${activeEnvId === e.id ? 'on' : ''}`}
              title={activeEnvId === e.id ? 'Environment ativo (clique para desativar)' : 'Ativar este environment'}
              onClick={(ev) => (ev.stopPropagation(), setActive(activeEnvId === e.id ? null : e.id))}
            >
              <Icon name="check" size={13} />
            </button>
            <span className="row-name">{e.name}</span>
            <div className="row-menu">
              <button
                className="icon-btn"
                title="Export"
                onClick={(ev) => (ev.stopPropagation(), useStore.getState().exportEnvironment(e.id))}
              >
                <Icon name="import" size={13} />
              </button>
              <button className="icon-btn" title="Duplicate" onClick={(ev) => (ev.stopPropagation(), duplicate(e.id))}>
                <Icon name="copy" size={13} />
              </button>
              <button
                className="icon-btn"
                title="Delete"
                onClick={(ev) => (ev.stopPropagation(), confirm(`Apagar o environment "${e.name}"?`) && remove(e.id))}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function HistoryPanel() {
  const history = useStore((s) => s.history)
  const open = useStore((s) => s.openHistory)
  const clear = useStore((s) => s.clearHistory)
  const [q, setQ] = useState('')
  const filtered = q ? history.filter((h) => (h.url + h.name).toLowerCase().includes(q.toLowerCase())) : history

  const groups: { label: string; items: typeof history }[] = []
  for (const h of filtered) {
    const label = dayLabel(h.createdAt)
    const g = groups[groups.length - 1]
    if (g && g.label === label) g.items.push(h)
    else groups.push({ label, items: [h] })
  }

  return (
    <>
      <div className="panel-head">
        <div className="search">
          <Icon name="search" size={14} />
          <input placeholder="Search history" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button
          className="icon-btn"
          title="Clear all"
          onClick={() => history.length && confirm('Apagar todo o histórico?') && clear()}
        >
          <Icon name="trash" />
        </button>
      </div>
      <div className="tree">
        {groups.length === 0 && <div className="empty">Nenhuma requisição enviada ainda.</div>}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="group-label">{g.label}</div>
            {g.items.map((h) => (
              <div key={h.id} className="row" style={{ paddingLeft: 8 }} onClick={() => open(h.id)} title={h.url}>
                <span className={`row-method ${methodClass(h.method)}`}>{methodLabel(h.method)}</span>
                <span className="row-name">{h.url || h.name}</span>
                <span className={`row-status ${h.status === null || h.status >= 400 ? 'bad' : ''}`}>{h.status ?? 'ERR'}</span>
                <div className="row-menu">
                  <button
                    className="icon-btn"
                    title="Remover do histórico"
                    onClick={async (e) => {
                      e.stopPropagation()
                      await api.invoke('history:delete', [h.id])
                      useStore.getState().loadHistory()
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}
