import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyValue } from '@shared/types'
import { Icon } from './icons'
import { lookupFor, methodClass, useStore } from './store'
import { VarContext } from './components/VarInput'
import { VariablesEditor } from './components/VariablesEditor'
import { AuthEditor } from './components/AuthEditor'
import { ScriptsEditor, hasScripts } from './components/ScriptsEditor'
import { TokenManager } from './components/TokenManager'
import { ConsolePanel } from './components/ConsolePanel'
import { RunnerView } from './components/Runner'
import { CodeDialog, CookieManager, SearchPalette, SettingsDialog } from './components/Dialogs'
import { useInherited } from './components/RequestEditor'
import type { OpenTab } from './store'
import { Sidebar } from './components/Sidebar'
import { RequestEditor } from './components/RequestEditor'
import { ResponsePane } from './components/ResponsePane'
import { SaveDialog } from './components/SaveDialog'
import { ExportDialog, ImportDialog, Toast } from './components/ImportExport'
import { DETACHED } from './windowMode'

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
    <div className={`app ${DETACHED ? 'detached' : ''}`}>
      {DETACHED ? <DetachedHeader /> : <Header />}
      <div className="body">
        {!DETACHED && <Sidebar />}
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
      <TokenManager />
      <SettingsDialog />
      <CookieManager />
      <CodeDialog />
      <SearchPalette />
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
      else if (k === 'k') (e.preventDefault(), useStore.getState().openModal('search'))
      else if (k === ',') (e.preventDefault(), useStore.getState().openModal('settings'))
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
      <div className="header-search no-drag" onClick={() => useStore.getState().openModal('search')}>
        <Icon name="search" size={14} />
        <input placeholder="Search JEFF Postman" readOnly onFocus={(e) => (e.target.blur(), useStore.getState().openModal('search'))} />
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
        <button className="icon-btn" title="Settings" onClick={() => useStore.getState().openModal('settings')}>
          <Icon name="settings" />
        </button>
      </div>
    </header>
  )
}

function tabTitleOf(t: OpenTab): string {
  if (t.runner) return `Runner${t.runner.name ? ` · ${t.runner.name}` : ''}`
  if (t.vars) return t.vars.name
  if (t.authOf) return `${t.authOf.name} · ${t.authOf.section === 'scripts' ? 'Scripts' : 'Authorization'}`
  return t.doc.name === 'Untitled Request' && t.doc.request.url.raw ? t.doc.request.url.raw : t.doc.name
}

function TabIcon({ t }: { t: OpenTab }) {
  if (t.runner)
    return (
      <span className="tab-method tab-icon">
        <Icon name="runner" size={13} />
      </span>
    )
  if (t.authOf)
    return (
      <span className="tab-method tab-icon">
        <Icon name="lock" size={13} />
      </span>
    )
  if (t.vars)
    return (
      <span className="tab-method tab-icon">
        <Icon name={t.vars.scope.type === 'globals' ? 'globe' : t.vars.scope.type === 'collection' ? 'collections' : 'environments'} size={13} />
      </span>
    )
  return <span className={`tab-method ${methodClass(t.doc.request.method)}`}>{t.doc.request.method}</span>
}

/** Cada janela informa ao main as requisições que tem abertas (para não abrir a mesma em duas janelas). */
function useReportOpenItems() {
  const ids = useStore((s) => s.tabs.map((t) => t.itemId).filter((x): x is string => !!x).join('|'))
  const title = useStore((s) => {
    const t = s.tabs.find((x) => x.key === s.activeTabKey)
    return t ? tabTitleOf(t) : 'JEFF Postman'
  })
  useEffect(() => {
    if (DETACHED) document.title = `${title} · JEFF Postman`
    window.jeffPostman?.invoke('window:setTabInfo', { itemIds: ids ? ids.split('|') : [], title }).catch(() => undefined)
  }, [ids, title])
}

function TabBar() {
  const tabs = useStore((s) => s.tabs)
  const active = useStore((s) => s.activeTabKey)
  const activate = useStore((s) => s.activateTab)
  const close = useStore((s) => s.closeTab)
  const newTab = useStore((s) => s.newTab)
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ left: false, right: false })
  const [list, setList] = useState(false)
  const moveTab = useStore((s) => s.moveTab)
  const detachTab = useStore((s) => s.detachTab)
  const moveTabTo = useStore((s) => s.moveTabTo)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const suppressClick = useRef(false)

  /**
   * Arrasto da aba com o mouse capturado (não o arrasto nativo do navegador, que mostra o "proibido" fora da
   * janela): o cursor fica de "mover" o tempo todo, dentro da barra a aba muda de lugar e, fora da janela, o main
   * mostra uma etiqueta ("Nova janela" ou "Anexar aqui") e acende a barra da janela de destino.
   */
  const startDrag = (e: React.PointerEvent<HTMLDivElement>, key: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.tab-close')) return
    const bar = ref.current
    if (!bar) return
    const x0 = e.clientX
    const y0 = e.clientY
    const pid = e.pointerId
    let on = false
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return
      if (!on) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return
        on = true
        // captura na barra (estável; a aba muda de lugar no DOM ao reordenar): o movimento chega mesmo fora da janela
        try {
          bar.setPointerCapture(pid)
        } catch {
          /* sem captura: o arrasto ainda funciona dentro da janela */
        }
        document.body.classList.add('tab-dragging')
        setDragKey(key)
        const st = useStore.getState()
        const tab = st.tabs.find((x) => x.key === key)
        window.jeffPostman
          .invoke('window:dragStart', { title: tab ? tabTitleOf(tab) : '', canDetach: !DETACHED || st.tabs.length > 1 })
          .catch(() => undefined)
      }
      // dentro da barra: reordena só depois de passar do meio da aba vizinha
      const r = bar.getBoundingClientRect()
      if (ev.clientY < r.top - 12 || ev.clientY > r.bottom + 12) return
      const list = useStore.getState().tabs
      const from = list.findIndex((x) => x.key === key)
      const els = [...bar.querySelectorAll<HTMLElement>('.tab')]
      els.forEach((el, i) => {
        if (i === from) return
        const b = el.getBoundingClientRect()
        if (ev.clientX < b.left || ev.clientX > b.right) return
        const past = from < i ? ev.clientX > b.left + b.width / 2 : ev.clientX < b.left + b.width / 2
        if (past) moveTab(key, i)
      })
    }
    const finish = async (ev: PointerEvent | null, cancel: boolean) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
      if (!on) return
      try {
        bar.releasePointerCapture(pid)
      } catch {
        /* já solta */
      }
      document.body.classList.remove('tab-dragging')
      setDragKey(null)
      // o clique que vem logo depois do soltar não ativa a aba
      suppressClick.current = true
      setTimeout(() => (suppressClick.current = false), 0)
      const inside = !!ev && ev.clientX >= 0 && ev.clientY >= 0 && ev.clientX < window.innerWidth && ev.clientY < window.innerHeight
      // o ponto de soltar vem do cursor, lido pelo main (exato com monitores de escalas diferentes)
      const where = await window.jeffPostman.invoke('window:dragEnd', null).catch(() => null)
      // soltou dentro da própria janela (ou cancelou): a aba fica onde está na barra
      if (cancel || inside || !where || where.over === 'self') return
      const p = { x: where.x, y: where.y }
      if (where.over === 'window') void moveTabTo(key, p, where.target)
      else void detachTab(key, p)
    }
    const up = (ev: PointerEvent) => ev.pointerId === pid && void finish(ev, false)
    const onCancel = (ev: PointerEvent) => ev.pointerId === pid && void finish(null, true)
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && void finish(null, true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
  }
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  useReportOpenItems()

  // setas aparecem só quando as abas não cabem; cada lado some ao chegar no fim
  const measure = () => {
    const el = ref.current
    if (!el) return
    const left = el.scrollLeft > 1
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right }))
  }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(measure, [tabs])
  // a aba ativa sempre fica à vista
  useEffect(() => {
    ref.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, tabs.length])
  const scrollBy = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * Math.max(200, (ref.current?.clientWidth ?? 400) * 0.7), behavior: 'smooth' })
  const overflow = edge.left || edge.right

  return (
    <div className="tabbar">
      {overflow && (
        <button className="icon-btn tab-scroll" title="Abas à esquerda" disabled={!edge.left} onClick={() => scrollBy(-1)}>
          <Icon name="chevron" size={12} style={{ transform: 'rotate(180deg)' }} />
        </button>
      )}
      <div
        className="tabs"
        ref={ref}
        onScroll={measure}
        onWheel={(e) => {
          // roda do mouse (vertical) também anda pelas abas
          if (ref.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) ref.current.scrollLeft += e.deltaY
        }}
      >
        {tabs.map((t) => (
          <div
            key={t.key}
            className={`tab ${t.key === active ? 'active' : ''} ${dragKey === t.key ? 'dragging' : ''}`}
            title={tabTitleOf(t)}
            onPointerDown={(e) => startDrag(e, t.key)}
            onClick={() => !suppressClick.current && activate(t.key)}
            onContextMenu={(e) => {
              e.preventDefault()
              // o menu não sai da janela perto das bordas
              setMenu({ key: t.key, x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 140) })
            }}
            onMouseDown={(e) => e.button === 1 && (e.preventDefault(), close(t.key))}
          >
            <TabIcon t={t} />
            <span className="tab-name">{tabTitleOf(t)}</span>
            <button className="tab-close" onClick={(e) => (e.stopPropagation(), close(t.key))}>
              {t.dirty ? <span className="dirty-dot" /> : <Icon name="close" size={12} />}
            </button>
          </div>
        ))}
      </div>
      {overflow && (
        <button className="icon-btn tab-scroll" title="Abas à direita" disabled={!edge.right} onClick={() => scrollBy(1)}>
          <Icon name="chevron" size={12} />
        </button>
      )}
      <button className="icon-btn tab-add" title="New tab (Ctrl+T)" onClick={() => newTab()}>
        <Icon name="plus" />
      </button>
      {tabs.length > 1 && (
        <div className="tab-list-wrap">
          <button className={`icon-btn tab-list-btn ${list ? 'active' : ''}`} title={`Abas abertas (${tabs.length})`} onClick={() => setList((v) => !v)}>
            <Icon name="chevron" size={12} style={{ transform: 'rotate(90deg)' }} />
            <span className="tab-count">{tabs.length}</span>
          </button>
          {list && (
            <>
              <div className="menu-backdrop" onMouseDown={() => setList(false)} />
              <div className="menu tab-list">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    className={t.key === active ? 'current' : ''}
                    onClick={() => {
                      activate(t.key)
                      setList(false)
                    }}
                  >
                    <TabIcon t={t} />
                    <span className="tab-name">{tabTitleOf(t)}</span>
                    {t.dirty && <span className="dirty-dot" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <EnvSelector />
      {menu && (
        <>
          <div className="menu-backdrop" onMouseDown={() => setMenu(null)} onContextMenu={(e) => (e.preventDefault(), setMenu(null))} />
          <div className="menu floating tab-menu" style={{ left: menu.x, top: menu.y }}>
            {DETACHED && (
              <button
                onClick={() => {
                  setMenu(null)
                  void moveTabTo(menu.key, null, null)
                }}
              >
                Mover para a janela principal
              </button>
            )}
            <button
              disabled={DETACHED && tabs.length < 2}
              onClick={() => {
                setMenu(null)
                void detachTab(menu.key, null)
              }}
            >
              Abrir em janela separada
            </button>
            <button
              onClick={() => {
                setMenu(null)
                close(menu.key)
              }}
            >
              Fechar
            </button>
            <button
              disabled={tabs.length < 2}
              onClick={() => {
                setMenu(null)
                for (const t of tabs) if (t.key !== menu.key) close(t.key)
              }}
            >
              Fechar as outras
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** Cabeçalho da janela destacada: título da aba ativa, tema e o botão de devolver as abas. */
function DetachedHeader() {
  const tab = useStore((s) => s.tabs.find((t) => t.key === s.activeTabKey))
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const attachBack = useStore((s) => s.attachBack)
  const title = tab ? tabTitleOf(tab) : 'JEFF Postman'
  return (
    <header className="header detached-header">
      <span className="logo">J</span>
      <span className="detached-title" title={title}>
        {title}
      </span>
      <div className="spacer" />
      <button className="icon-btn no-drag" title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      </button>
      <button
        className="btn small ghost no-drag attach-btn"
        title="Devolver as abas para a janela principal e fechar esta (o mesmo que fechar a janela)"
        onClick={() => void attachBack()}
      >
        Anexar à janela principal
      </button>
    </header>
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
  if (tab?.runner) return <RunnerView tab={tab} />
  if (tab?.authOf)
    return (
      <VarContext.Provider value={lookup}>
        <ContainerAuth tab={tab} />
      </VarContext.Provider>
    )
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
  return panel === 'console' ? <ConsolePanel /> : null
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
      <button className="foot-btn" onClick={() => useStore.getState().openRunner(useStore.getState().collections[0]?.id ?? null, null)}>
        <Icon name="runner" size={14} /> Runner
      </button>
      <button className="foot-btn" onClick={() => useStore.getState().openModal('cookies')}>
        <Icon name="cookie" size={14} /> Cookies
      </button>
      <span className="foot-info">{info}</span>
    </footer>
  )
}

/** Aba de auth de collection ou pasta (como a aba Authorization da collection/pasta no Postman). */
function ContainerAuth({ tab }: { tab: OpenTab }) {
  const a = tab.authOf!
  const update = useStore((s) => s.updateAuthTab)
  const updateContainer = useStore((s) => s.updateContainer)
  const save = useStore((s) => s.saveActive)
  const inherited = useInheritedForFolder(a)
  return (
    <div className="vars-editor">
      <div className="vars-head">
        <span className="vars-kind">
          <Icon name={a.kind === 'collection' ? 'collections' : 'folder'} size={16} />
          {a.kind === 'collection' ? 'Collection' : 'Folder'}
        </span>
        <span className="vars-title">{a.name}</span>
        <div className="spacer" />
        <button className="btn ghost" disabled={!tab.dirty} onClick={() => save()} title="Ctrl+S">
          Save
        </button>
      </div>
      <div className="subtabs container-tabs">
        {(
          [
            ['auth', 'Authorization'],
            ['scripts', 'Scripts']
          ] as ['auth' | 'scripts', string][]
        ).map(([id, label]) => (
          <button key={id} className={`subtab ${a.section === id ? 'active' : ''}`} onClick={() => updateContainer({ section: id }, false)}>
            {label}
            {id === 'scripts' && hasScripts(a.events) ? <span className="dot-green" /> : null}
          </button>
        ))}
      </div>
      {a.section === 'scripts' ? (
        <>
          <p className="vars-hint">
            {a.kind === 'collection'
              ? 'Roda em toda requisição da collection: pre-request antes dos das pastas e da requisição; post-response também antes.'
              : 'Roda em toda requisição desta pasta (e subpastas), depois dos scripts da collection e antes dos da requisição.'}
          </p>
          <div className="container-scripts">
            <ScriptsEditor events={a.events} onChange={(events) => updateContainer({ events })} />
          </div>
        </>
      ) : (
        <>
      <p className="vars-hint">
        {a.kind === 'collection'
          ? 'Vale para todas as requisições da collection que estiverem com "Inherit auth from parent".'
          : 'Vale para as requisições desta pasta (e subpastas) que estiverem com "Inherit auth from parent".'}
      </p>
      <AuthEditor
        auth={a.kind === 'collection' && !a.auth ? { type: 'noauth' } : a.auth}
        allowInherit={a.kind === 'folder'}
        inherited={inherited}
        collectionId={a.collectionId}
        onChange={(auth) => update(a.kind === 'collection' && auth?.type === 'noauth' ? undefined : auth)}
      />
        </>
      )}
    </div>
  )
}

function useInheritedForFolder(a: NonNullable<OpenTab['authOf']>) {
  // pasta herda da pasta-mãe ou da collection; reaproveita o hook passando o id da pasta como "item"
  return useInherited(a.kind === 'folder' ? a.collectionId : null, a.kind === 'folder' ? a.id : null)
}
