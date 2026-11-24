import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyValue } from '@shared/types'
import { Icon } from './icons'
import { lookupFor, methodClass, useStore } from './store'
import { VarContext } from './components/VarInput'
import { VariablesEditor } from './components/VariablesEditor'
import { Sidebar } from './components/Sidebar'
import { RequestEditor } from './components/RequestEditor'
import { ResponsePane } from './components/ResponsePane'
import { SaveDialog } from './components/SaveDialog'
import { ExportDialog, ImportDialog, Toast } from './components/ImportExport'

export function App() {
  const init = useStore((s) => s.init)
  const theme = useStore((s) => s.theme)

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.jeffPostman?.invoke('app:setTheme', theme)
  }, [theme])

  useShortcuts()

  return (
    <div className="app">
      <Header />
      <div className="body">
        <Sidebar />
        <main className="main">
          <TabBar />
          <Workbench />
        </main>
      </div>
      <BottomPanel />
      <Footer />
      <SaveDialog />
      <ImportDialog />
      <ExportDialog />
      <Toast />
    </div>
  )
}

function useShortcuts() {
  const newTab = useStore((s) => s.newTab)
  const closeTab = useStore((s) => s.closeTab)
  const save = useStore((s) => s.saveActive)
  const togglePanel = useStore((s) => s.togglePanel)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      const k = e.key.toLowerCase()
      if (k === 'enter') (e.preventDefault(), useStore.getState().sendActive())
      else if (k === 's') (e.preventDefault(), save())
      else if (k === 'o') (e.preventDefault(), useStore.getState().openImport())
      else if (k === 'd') {
        e.preventDefault()
        const s = useStore.getState()
        const tab = s.tabs.find((t) => t.key === s.activeTabKey)
        const item = tab?.collectionId ? s.items[tab.collectionId]?.find((i) => i.id === tab.itemId) : undefined
        if (item) s.duplicateItem(item)
      }
      else if (k === 't') (e.preventDefault(), newTab())
      else if (k === 'w') {
        e.preventDefault()
        const key = useStore.getState().activeTabKey
        if (key) closeTab(key)
      } else if (e.altKey && k === 'c') (e.preventDefault(), togglePanel('console'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newTab, closeTab, save, togglePanel])
}

function Header() {
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const newTab = useStore((s) => s.newTab)
  return (
    <header className="header">
      <div className="brand">
        <span className="logo">J</span>
        <span>JEFF Postman</span>
      </div>
      <nav className="header-nav no-drag">
        <button className="link-btn">Home</button>
        <button className="link-btn">Workspaces ▾</button>
      </nav>
      <div className="header-search no-drag">
        <Icon name="search" size={14} />
        <input placeholder="Search JEFF Postman" />
        <kbd>Ctrl K</kbd>
      </div>
      <div className="header-actions no-drag">
        <button className="btn small" onClick={() => newTab()}>New</button>
        <button className="btn small ghost" onClick={() => useStore.getState().openImport()} title="Ctrl+O">
          <Icon name="import" size={14} /> Import
        </button>
        <button
          className="icon-btn"
          title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <button className="icon-btn" title="Settings"><Icon name="settings" /></button>
      </div>
    </header>
  )
}

function TabBar() {
  const tabs = useStore((s) => s.tabs)
  const active = useStore((s) => s.activeTabKey)
  const activate = useStore((s) => s.activateTab)
  const close = useStore((s) => s.closeTab)
  const newTab = useStore((s) => s.newTab)
  return (
    <div className="tabbar">
      <div className="tabs">
        {tabs.map((t) => (
          <div
            key={t.key}
            className={`tab ${t.key === active ? 'active' : ''}`}
            onClick={() => activate(t.key)}
            onMouseDown={(e) => e.button === 1 && (e.preventDefault(), close(t.key))}
          >
            {t.vars ? (
              <span className="tab-method tab-icon">
                <Icon name={t.vars.scope.type === 'globals' ? 'globe' : t.vars.scope.type === 'collection' ? 'collections' : 'environments'} size={13} />
              </span>
            ) : (
              <span className={`tab-method ${methodClass(t.doc.request.method)}`}>{t.doc.request.method}</span>
            )}
            <span className="tab-name">
              {t.vars ? t.vars.name : null}
              {t.vars ? null : t.doc.name === 'Untitled Request' && t.doc.request.url.raw ? t.doc.request.url.raw : t.doc.name}
            </span>
            <button className="tab-close" onClick={(e) => (e.stopPropagation(), close(t.key))}>
              {t.dirty ? <span className="dirty-dot" /> : <Icon name="close" size={12} />}
            </button>
          </div>
        ))}
        <button className="icon-btn tab-add" title="New tab (Ctrl+T)" onClick={() => newTab()}>
          <Icon name="plus" />
        </button>
      </div>
      <EnvSelector />
    </div>
  )
}

function EnvSelector() {
  const envs = useStore((s) => s.environments)
  const activeEnvId = useStore((s) => s.activeEnvId)
  const setActive = useStore((s) => s.setActiveEnv)
  return (
    <div className="env-selector">
      <select value={activeEnvId ?? ''} onChange={(e) => setActive(e.target.value || null)}>
        <option value="">No environment</option>
        {envs.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
      <QuickLook />
    </div>
  )
}

function QuickLook() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const env = useStore((s) => s.environments.find((e) => e.id === s.activeEnvId))
  const globals = useStore((s) => s.globals)
  const openVars = useStore((s) => s.openVariables)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const table = (values: KeyValue[]) =>
    values.filter((v) => v.key).length === 0 ? (
      <div className="ql-empty">Sem variáveis</div>
    ) : (
      <table className="ql-table">
        <tbody>
          {values
            .filter((v) => v.key)
            .map((v) => (
              <tr key={v.key} className={v.disabled ? 'disabled' : ''}>
                <td>{v.key}</td>
                <td className="mono">{v.type === 'secret' ? '••••••' : v.value}</td>
              </tr>
            ))}
        </tbody>
      </table>
    )
  return (
    <div className="ql" ref={ref}>
      <button className={`icon-btn ${open ? 'on' : ''}`} title="Environment quick look" onClick={() => setOpen((o) => !o)}>
        <Icon name="eye" />
      </button>
      {open && (
        <div className="ql-pop">
          <div className="ql-sec">
            <div className="ql-head">
              <b>{env ? env.name : 'No environment selected'}</b>
              {env && (
                <button className="link" onClick={() => (setOpen(false), openVars({ type: 'environment', id: env.id }))}>
                  Edit
                </button>
              )}
            </div>
            {env ? table(env.values) : <div className="ql-empty">Escolha um environment no seletor ao lado.</div>}
          </div>
          <div className="ql-sec">
            <div className="ql-head">
              <b>Globals</b>
              <button className="link" onClick={() => (setOpen(false), openVars({ type: 'globals' }))}>
                Edit
              </button>
            </div>
            {table(globals)}
          </div>
        </div>
      )}
    </div>
  )
}

function Workbench() {
  const tab = useStore((s) => s.tabs.find((t) => t.key === s.activeTabKey))
  const newTab = useStore((s) => s.newTab)
  const split = useStore((s) => s.split)
  const setSplit = useStore((s) => s.setSplit)
  const ref = useRef<HTMLDivElement>(null)
  const globals = useStore((s) => s.globals)
  const collections = useStore((s) => s.collections)
  const environments = useStore((s) => s.environments)
  const activeEnvId = useStore((s) => s.activeEnvId)
  const collectionId = tab?.collectionId ?? null
  const lookup = useMemo(
    () => lookupFor({ globals, collections, environments, activeEnvId }, collectionId),
    [globals, collections, environments, activeEnvId, collectionId]
  )
  if (tab?.vars) return <VariablesEditor tab={tab} />
  if (!tab)
    return (
      <div className="workbench-empty">
        <Icon name="rocket" size={48} />
        <p>Abra uma requisição da barra lateral ou crie uma nova.</p>
        <button className="btn" onClick={() => newTab()}>New Request</button>
      </div>
    )
  return (
    <div className="workbench" ref={ref}>
      <div className="pane-top" style={{ flexBasis: `${split * 100}%` }}>
        <VarContext.Provider value={lookup}>
          <RequestEditor tab={tab} />
        </VarContext.Provider>
      </div>
      <div
        className="splitter"
        onMouseDown={(e) => {
          e.preventDefault()
          const box = ref.current!.getBoundingClientRect()
          const move = (ev: MouseEvent) => setSplit((ev.clientY - box.top) / box.height)
          const up = () => (window.removeEventListener('mousemove', move), window.removeEventListener('mouseup', up))
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
        }}
      />
      <section className="response">
        <ResponsePane run={tab.run} />
      </section>
    </div>
  )
}

function BottomPanel() {
  const panel = useStore((s) => s.bottomPanel)
  const toggle = useStore((s) => s.togglePanel)
  if (panel !== 'console') return null
  return (
    <section className="bottom-panel">
      <div className="bottom-head">
        <span>Console</span>
        <div className="spacer" />
        <button className="icon-btn" onClick={() => toggle('console')}><Icon name="close" size={12} /></button>
      </div>
      <div className="console-empty">Nenhum log. As requisições e os console.log dos scripts aparecem aqui (fase 7).</div>
    </section>
  )
}

function Footer() {
  const toggle = useStore((s) => s.togglePanel)
  const [info, setInfo] = useState('')
  useEffect(() => {
    window.jeffPostman
      ?.invoke('app:info')
      .then((i) => setInfo(`v${i.version} · Electron ${i.electron}`))
      .catch(() => setInfo(''))
  }, [])
  return (
    <footer className="footer">
      <button className="foot-btn" onClick={() => toggle('console')}><Icon name="console" size={14} /> Console</button>
      <div className="spacer" />
      <button className="foot-btn"><Icon name="runner" size={14} /> Runner</button>
      <button className="foot-btn"><Icon name="cookie" size={14} /> Cookies</button>
      <span className="foot-info">{info}</span>
    </footer>
  )
}
