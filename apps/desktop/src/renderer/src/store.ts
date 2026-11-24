import { create } from 'zustand'
import type {
  Collection,
  Environment,
  HistoryEntry,
  OAuth2Token,
  PmAuth,
  ImportResult,
  HttpMethod,
  HttpResponse,
  KeyValue,
  RequestDoc,
  SentRequest,
  TreeItem
} from '@shared/types'
import { api } from './api'
import { setParam } from '@shared/auth'
import { makeLookup, type Lookup, type Scope } from '@shared/variables'

export type SidebarView = 'collections' | 'environments' | 'history'
export type RequestTab = 'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'settings'
export type Theme = 'dark' | 'light'

export interface OpenTab {
  key: string
  itemId: string | null
  collectionId: string | null
  doc: RequestDoc
  dirty: boolean
  subTab: RequestTab
  run: RunState | null
  /** presente quando a aba edita variáveis (environment, globals ou collection) em vez de uma requisição */
  vars?: VarsTab
  /** presente quando a aba edita o auth de uma collection ou pasta */
  authOf?: AuthTab
}

export interface AuthTab {
  kind: 'collection' | 'folder'
  id: string
  collectionId: string
  parentId: string | null
  name: string
  auth: PmAuth | undefined
}

export type VarScope = { type: 'environment'; id: string } | { type: 'globals' } | { type: 'collection'; id: string }

export interface VarsTab {
  scope: VarScope
  name: string
  values: KeyValue[]
}

const sameScope = (a: VarScope, b: VarScope) =>
  a.type === b.type && (a.type === 'globals' || (a as { id: string }).id === (b as { id: string }).id)

export type RunState =
  | { state: 'loading'; requestId: string; startedAt: number }
  | { state: 'done'; requestId: string; response: HttpResponse }
  | { state: 'error'; requestId: string; error: string; code: string | null; request: SentRequest | null }
  | { state: 'cancelled'; requestId: string }

interface State {
  theme: Theme
  sidebarView: SidebarView
  collections: Collection[]
  items: Record<string, TreeItem[]>
  expanded: Record<string, boolean>
  environments: Environment[]
  activeEnvId: string | null
  tabs: OpenTab[]
  activeTabKey: string | null
  bottomPanel: 'none' | 'console'
  appVersion: string
  history: HistoryEntry[]
  /** fração da altura do editor de requisição (resto é a resposta) */
  split: number

  init(): Promise<void>
  setTheme(t: Theme): void
  setSidebarView(v: SidebarView): void
  toggleExpanded(id: string): void
  togglePanel(p: 'console'): void
  setActiveEnv(id: string | null): void

  createCollection(name?: string): Promise<void>
  renameCollection(id: string, name: string): Promise<void>
  deleteCollection(id: string): Promise<void>
  createItem(collectionId: string, parentId: string | null, kind: 'folder' | 'request'): Promise<void>
  deleteItem(item: TreeItem): Promise<void>
  renameItem(item: TreeItem, name: string): Promise<void>
  duplicateItem(item: TreeItem): Promise<void>
  duplicateCollection(id: string): Promise<void>
  moveItem(item: TreeItem, collectionId: string, parentId: string | null, beforeId: string | null): Promise<void>
  refreshCollections(ids: string[]): Promise<void>
  expand(ids: string[]): void
  /** aba cuja requisição nova está sendo salva numa collection (diálogo Save) */
  saveDialogTabKey: string | null
  closeSaveDialog(): void
  saveActiveAs(name: string, collectionId: string, parentId: string | null): Promise<void>
  createEnvironment(): Promise<void>
  globals: KeyValue[]
  oauthTokens: OAuth2Token[]
  loadTokens(): Promise<void>
  tokenManager: boolean
  tokenPick: ((t: OAuth2Token) => void) | null
  openTokenManager(pick?: (t: OAuth2Token) => void): void
  closeTokenManager(): void
  /** muda quando o auth de alguma collection/pasta é salvo (para refazer o "herdado") */
  authVersion: number
  openAuthTab(kind: 'collection' | 'folder', id: string): Promise<void>
  updateAuthTab(auth: PmAuth | undefined): void
  importOpen: boolean
  openImport(): void
  closeImport(): void
  applyImport(results: ImportResult[]): Promise<void>
  exportCollectionId: string | null
  openExport(id: string): void
  closeExport(): void
  exportEnvironment(id: string | null): Promise<void>
  toast: { text: string; kind: 'ok' | 'bad' } | null
  showToast(text: string, kind?: 'ok' | 'bad'): void
  hideToast(): void
  openVariables(scope: VarScope): void
  updateVars(fn: (v: VarsTab) => VarsTab): void
  saveVariables(key: string): Promise<void>
  duplicateEnvironment(id: string): Promise<void>
  deleteEnvironment(id: string): Promise<void>

  openItem(item: TreeItem): Promise<void>
  newTab(): void
  closeTab(key: string): void
  activateTab(key: string): void
  updateActive(fn: (doc: RequestDoc) => RequestDoc): void
  setSubTab(t: RequestTab): void
  saveActive(): Promise<void>

  sendActive(): Promise<void>
  cancelActive(): void
  loadHistory(): Promise<void>
  openHistory(id: number): Promise<void>
  clearHistory(): Promise<void>
  setSplit(f: number): void
}

let tabCounter = 0
const blankDoc = (): RequestDoc => ({
  name: 'Untitled Request',
  request: { method: 'GET', url: { raw: '' }, header: [], body: { mode: 'none' } }
})

export const useStore = create<State>((set, get) => ({
  theme: 'dark',
  sidebarView: 'collections',
  collections: [],
  items: {},
  expanded: {},
  environments: [],
  activeEnvId: null,
  tabs: [],
  activeTabKey: null,
  bottomPanel: 'none',
  saveDialogTabKey: null,
  globals: [],
  oauthTokens: [],
  tokenManager: false,
  tokenPick: null,
  authVersion: 0,
  importOpen: false,
  exportCollectionId: null,
  toast: null,
  appVersion: '0.0.0',
  history: [],
  split: 0.5,

  async init() {
    const [collections, environments, theme, activeEnvId, info, history, split, expanded, globals] = await Promise.all([
      api.invoke('collections:list'),
      api.invoke('environments:list'),
      api.invoke('state:get', 'theme'),
      api.invoke('state:get', 'activeEnvId'),
      api.invoke('app:info').catch(() => null),
      api.invoke('history:list', 300).catch(() => []),
      api.invoke('state:get', 'split'),
      api.invoke('state:get', 'expanded'),
      api.invoke('globals:get').catch(() => [])
    ])
    const items: Record<string, TreeItem[]> = {}
    await Promise.all(collections.map(async (c) => (items[c.id] = await api.invoke('items:list', c.id))))
    set({
      collections,
      environments,
      items,
      theme: theme === 'light' ? 'light' : 'dark',
      activeEnvId: typeof activeEnvId === 'string' ? activeEnvId : null,
      appVersion: info?.version ?? '0.0.0',
      history,
      split: typeof split === 'number' ? split : 0.5,
      expanded: expanded && typeof expanded === 'object' ? (expanded as Record<string, boolean>) : {},
      globals
    })
    if (get().tabs.length === 0) get().newTab()
  },

  setTheme(theme) {
    set({ theme })
    api.invoke('state:set', 'theme', theme)
  },
  setSidebarView(sidebarView) {
    set({ sidebarView })
  },
  toggleExpanded(id) {
    set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } }))
    persistExpanded()
  },
  expand(ids) {
    set((s) => {
      const expanded = { ...s.expanded }
      for (const id of ids) expanded[id] = true
      return { expanded }
    })
    persistExpanded()
  },
  togglePanel(p) {
    set((s) => ({ bottomPanel: s.bottomPanel === p ? 'none' : p }))
  },
  setActiveEnv(id) {
    set({ activeEnvId: id })
    api.invoke('state:set', 'activeEnvId', id)
  },

  async createCollection(name = 'New Collection') {
    const c = await api.invoke('collections:create', name)
    set((s) => ({
      collections: [...s.collections, c].sort((a, b) => a.name.localeCompare(b.name)),
      items: { ...s.items, [c.id]: [] },
      expanded: { ...s.expanded, [c.id]: true }
    }))
  },
  async renameCollection(id, name) {
    await api.invoke('collections:rename', id, name)
    set((s) => ({ collections: s.collections.map((c) => (c.id === id ? { ...c, name } : c)) }))
  },
  async deleteCollection(id) {
    await api.invoke('collections:delete', id)
    set((s) => {
      const items = { ...s.items }
      delete items[id]
      return {
        collections: s.collections.filter((c) => c.id !== id),
        items,
        tabs: s.tabs.map((t) => (t.collectionId === id ? { ...t, itemId: null, collectionId: null, dirty: true } : t))
      }
    })
  },
  async createItem(collectionId, parentId, kind) {
    const name = kind === 'folder' ? 'New Folder' : 'New Request'
    const item = await api.invoke('items:create', { collectionId, parentId, kind, name, method: 'GET' })
    set((s) => ({
      items: { ...s.items, [collectionId]: [...(s.items[collectionId] ?? []), item] },
      expanded: { ...s.expanded, [collectionId]: true, ...(parentId ? { [parentId]: true } : {}) }
    }))
    if (kind === 'request') await get().openItem(item)
  },
  async deleteItem(item) {
    await api.invoke('items:delete', item.id)
    const list = await api.invoke('items:list', item.collectionId)
    const alive = new Set(list.map((i) => i.id))
    set((s) => ({
      items: { ...s.items, [item.collectionId]: list },
      tabs: s.tabs.map((t) => (t.itemId && !alive.has(t.itemId) ? { ...t, itemId: null, collectionId: null, dirty: true } : t))
    }))
  },
  async createEnvironment() {
    const e = await api.invoke('environments:create', 'New Environment')
    set((s) => ({ environments: [...s.environments, e] }))
    get().openVariables({ type: 'environment', id: e.id })
  },
  async loadTokens() {
    set({ oauthTokens: await api.invoke('oauth2:listTokens') })
  },
  openTokenManager(pick) {
    set({ tokenManager: true, tokenPick: pick ?? null })
  },
  closeTokenManager() {
    set({ tokenManager: false, tokenPick: null })
  },
  async openAuthTab(kind, id) {
    const existing = get().tabs.find((t) => t.authOf && t.authOf.kind === kind && t.authOf.id === id)
    if (existing) return set({ activeTabKey: existing.key })
    let auth: PmAuth | undefined
    let name = ''
    let collectionId = id
    let parentId: string | null = null
    if (kind === 'collection') {
      auth = (await api.invoke('collections:getAuth', id)) ?? undefined
      name = get().collections.find((c) => c.id === id)?.name ?? ''
    } else {
      const f = await api.invoke('items:getFolder', id)
      if (!f) return
      auth = f.auth
      name = f.name
      for (const [cid, list] of Object.entries(get().items)) {
        const it = list.find((x) => x.id === id)
        if (it) {
          collectionId = cid
          parentId = it.parentId
        }
      }
    }
    const tab: OpenTab = {
      key: `t${++tabCounter}`,
      itemId: null,
      collectionId,
      doc: blankDoc(),
      dirty: false,
      subTab: 'auth',
      run: null,
      authOf: { kind, id, collectionId, parentId, name, auth }
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabKey: tab.key }))
  },
  updateAuthTab(auth) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.key === s.activeTabKey && t.authOf ? { ...t, authOf: { ...t.authOf, auth }, dirty: true } : t))
    }))
  },
  openImport() {
    set({ importOpen: true })
  },
  closeImport() {
    set({ importOpen: false })
  },
  async applyImport(results) {
    for (const r of results) {
      if (!r.ok) continue
      if (r.kind === 'collection') {
        const list = await api.invoke('items:list', r.collection.id)
        set((s) => ({
          collections: [...s.collections, r.collection].sort((a, b) => a.name.localeCompare(b.name)),
          items: { ...s.items, [r.collection.id]: list },
          sidebarView: 'collections'
        }))
        get().expand([r.collection.id])
      } else if (r.kind === 'environment') {
        set((s) => ({ environments: [...s.environments, r.environment] }))
      } else if (r.kind === 'globals') {
        set({ globals: r.globals })
      } else if (r.kind === 'curl') {
        const tab: OpenTab = { key: `t${++tabCounter}`, itemId: null, collectionId: null, doc: normalizeDoc(r.doc), dirty: true, subTab: 'params', run: null }
        set((s) => ({ tabs: [...s.tabs, tab], activeTabKey: tab.key }))
      }
    }
  },
  openExport(id) {
    set({ exportCollectionId: id })
  },
  closeExport() {
    set({ exportCollectionId: null })
  },
  async exportEnvironment(id) {
    try {
      const path = id ? await api.invoke('export:environment', id) : await api.invoke('export:globals')
      if (path) get().showToast(`Exportado em ${path}`)
    } catch (e) {
      get().showToast(`Falha ao exportar: ${(e as Error).message}`, 'bad')
    }
  },
  showToast(text, kind = 'ok') {
    set({ toast: { text, kind } })
  },
  hideToast() {
    set({ toast: null })
  },
  openVariables(scope) {
    const existing = get().tabs.find((t) => t.vars && sameScope(t.vars.scope, scope))
    if (existing) return set({ activeTabKey: existing.key })
    const s = get()
    let name = 'Globals'
    let values: KeyValue[] = s.globals
    if (scope.type === 'environment') {
      const e = s.environments.find((x) => x.id === scope.id)
      if (!e) return
      name = e.name
      values = e.values
    } else if (scope.type === 'collection') {
      const c = s.collections.find((x) => x.id === scope.id)
      if (!c) return
      name = c.name
      values = c.variables
    }
    const tab: OpenTab = {
      key: `t${++tabCounter}`,
      itemId: null,
      collectionId: scope.type === 'collection' ? scope.id : null,
      doc: blankDoc(),
      dirty: false,
      subTab: 'params',
      run: null,
      vars: { scope, name, values: values.map((v) => ({ ...v })) }
    }
    set((st) => ({ tabs: [...st.tabs, tab], activeTabKey: tab.key }))
  },
  updateVars(fn) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.key === s.activeTabKey && t.vars ? { ...t, vars: fn(t.vars), dirty: true } : t))
    }))
  },
  async saveVariables(key) {
    const tab = get().tabs.find((t) => t.key === key)
    if (!tab?.vars) return
    const { scope, name } = tab.vars
    const values = tab.vars.values.filter((v) => v.key.trim() || v.value)
    if (scope.type === 'environment') {
      const e = await api.invoke('environments:update', scope.id, { name, values })
      set((s) => ({ environments: s.environments.map((x) => (x.id === e.id ? e : x)) }))
    } else if (scope.type === 'globals') {
      await api.invoke('globals:set', values)
      set({ globals: values })
    } else {
      await api.invoke('collections:setVariables', scope.id, values)
      set((s) => ({ collections: s.collections.map((c) => (c.id === scope.id ? { ...c, variables: values } : c)) }))
    }
    set((s) => ({ tabs: s.tabs.map((t) => (t.key === key && t.vars ? { ...t, dirty: false, vars: { ...t.vars, values } } : t)) }))
  },
  async duplicateEnvironment(id) {
    const e = await api.invoke('environments:duplicate', id)
    set((s) => ({ environments: [...s.environments, e] }))
  },
  async deleteEnvironment(id) {
    await api.invoke('environments:delete', id)
    set((s) => ({
      environments: s.environments.filter((e) => e.id !== id),
      activeEnvId: s.activeEnvId === id ? null : s.activeEnvId,
      tabs: s.tabs.filter((t) => !(t.vars?.scope.type === 'environment' && t.vars.scope.id === id)),
      activeTabKey: s.tabs.find((t) => t.key === s.activeTabKey && t.vars?.scope.type === 'environment' && t.vars.scope.id === id)
        ? (s.tabs.find((t) => !(t.vars?.scope.type === 'environment' && t.vars.scope.id === id))?.key ?? null)
        : s.activeTabKey
    }))
    if (get().activeEnvId === null) api.invoke('state:set', 'activeEnvId', null)
  },

  async openItem(item) {
    if (item.kind !== 'request') return
    const existing = get().tabs.find((t) => t.itemId === item.id)
    if (existing) return set({ activeTabKey: existing.key })
    const doc = await api.invoke('items:get', item.id)
    if (!doc) return
    const tab: OpenTab = {
      key: `t${++tabCounter}`,
      itemId: item.id,
      collectionId: item.collectionId,
      doc: normalizeDoc(doc),
      dirty: false,
      subTab: 'params',
      run: null
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabKey: tab.key }))
  },
  newTab() {
    const tab: OpenTab = { key: `t${++tabCounter}`, itemId: null, collectionId: null, doc: blankDoc(), dirty: false, subTab: 'params', run: null }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabKey: tab.key }))
  },
  closeTab(key) {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.key === key)
      const tabs = s.tabs.filter((t) => t.key !== key)
      let activeTabKey = s.activeTabKey
      if (activeTabKey === key) activeTabKey = tabs[Math.min(idx, tabs.length - 1)]?.key ?? null
      return { tabs, activeTabKey }
    })
  },
  activateTab(activeTabKey) {
    set({ activeTabKey })
  },
  updateActive(fn) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.key === s.activeTabKey ? { ...t, doc: fn(t.doc), dirty: true } : t))
    }))
  },
  setSubTab(subTab) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.key === s.activeTabKey ? { ...t, subTab } : t)) }))
  },
  async saveActive() {
    const tab = get().tabs.find((t) => t.key === get().activeTabKey)
    if (!tab) return
    if (tab.vars) return get().saveVariables(tab.key)
    if (tab.authOf) {
      const a = tab.authOf
      if (a.kind === 'collection') await api.invoke('collections:setAuth', a.id, a.auth ?? null)
      else await api.invoke('items:setFolderAuth', a.id, a.auth ?? null)
      set((s) => ({ authVersion: s.authVersion + 1, tabs: s.tabs.map((t) => (t.key === tab.key ? { ...t, dirty: false } : t)) }))
      return
    }
    if (!tab.itemId || !tab.collectionId) return set({ saveDialogTabKey: tab.key })
    await api.invoke('items:saveRequest', tab.itemId, tab.doc)
    const collectionId = tab.collectionId
    set((s) => ({
      tabs: s.tabs.map((t) => (t.key === tab.key ? { ...t, dirty: false } : t)),
      items: {
        ...s.items,
        [collectionId]: (s.items[collectionId] ?? []).map((i) =>
          i.id === tab.itemId ? { ...i, name: tab.doc.name, method: tab.doc.request.method } : i
        )
      }
    }))
  },

  async sendActive() {
    const tab = get().tabs.find((t) => t.key === get().activeTabKey)
    if (!tab || tab.vars || tab.authOf || tab.run?.state === 'loading' || !tab.doc.request.url.raw.trim()) return
    const requestId = crypto.randomUUID()
    const key = tab.key
    const setRun = (run: RunState) =>
      set((s) => ({
        tabs: s.tabs.map((t) => (t.key === key && (!t.run || t.run.requestId === requestId || run.state === 'loading') ? { ...t, run } : t))
      }))
    setRun({ state: 'loading', requestId, startedAt: Date.now() })
    const result = await api.invoke('http:send', {
      requestId,
      doc: tab.doc,
      environmentId: get().activeEnvId,
      collectionId: tab.collectionId,
      itemId: tab.itemId
    })
    if (result.ok) {
      setRun({ state: 'done', requestId, response: result.response })
      const t = result.response.refreshedToken
      if (t) {
        // token renovado no envio: atualiza o token atual da aba (se o auth é dela) e a lista
        set((s) => ({
          tabs: s.tabs.map((x) =>
            x.key === key && x.doc.request.auth?.type === 'oauth2'
              ? { ...x, doc: { ...x.doc, request: { ...x.doc.request, auth: setParam(x.doc.request.auth, 'accessToken', t.accessToken) } } }
              : x
          )
        }))
        get().loadTokens()
        get().showToast(`Token "${t.name}" renovado automaticamente`)
      }
    }
    else if (result.cancelled) setRun({ state: 'cancelled', requestId })
    else setRun({ state: 'error', requestId, error: result.error, code: result.code, request: result.request })
    get().loadHistory()
  },
  cancelActive() {
    const run = get().tabs.find((t) => t.key === get().activeTabKey)?.run
    if (run?.state === 'loading') api.invoke('http:cancel', run.requestId)
  },
  async loadHistory() {
    set({ history: await api.invoke('history:list', 300) })
  },
  async openHistory(id) {
    const doc = await api.invoke('history:get', id)
    if (!doc) return
    const tab: OpenTab = { key: `t${++tabCounter}`, itemId: null, collectionId: null, doc: normalizeDoc(doc), dirty: false, subTab: 'params', run: null }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabKey: tab.key }))
  },
  async clearHistory() {
    await api.invoke('history:clear')
    set({ history: [] })
  },
  setSplit(split) {
    const f = Math.min(0.85, Math.max(0.15, split))
    set({ split: f })
    api.invoke('state:set', 'split', f)
  },

  async renameItem(item, name) {
    const n = name.trim()
    if (!n || n === item.name) return
    await api.invoke('items:rename', item.id, n)
    set((s) => ({
      items: { ...s.items, [item.collectionId]: (s.items[item.collectionId] ?? []).map((i) => (i.id === item.id ? { ...i, name: n } : i)) },
      tabs: s.tabs.map((t) => (t.itemId === item.id ? { ...t, doc: { ...t.doc, name: n } } : t))
    }))
  },
  async duplicateItem(item) {
    await api.invoke('items:duplicate', item.id)
    await get().refreshCollections([item.collectionId])
  },
  async duplicateCollection(id) {
    const c = await api.invoke('collections:duplicate', id)
    const list = await api.invoke('items:list', c.id)
    set((s) => ({
      collections: [...s.collections, c].sort((a, b) => a.name.localeCompare(b.name)),
      items: { ...s.items, [c.id]: list }
    }))
  },
  async moveItem(item, collectionId, parentId, beforeId) {
    if (item.id === beforeId) return
    await api.invoke('items:move', item.id, collectionId, parentId, beforeId)
    await get().refreshCollections([...new Set([item.collectionId, collectionId])])
    get().expand([collectionId, ...(parentId ? [parentId] : [])])
  },
  async refreshCollections(ids) {
    const lists = await Promise.all(ids.map((id) => api.invoke('items:list', id)))
    set((s) => {
      const items = { ...s.items }
      ids.forEach((id, i) => (items[id] = lists[i]))
      const owner = new Map<string, string>()
      for (const [cid, list] of Object.entries(items)) for (const it of list) owner.set(it.id, cid)
      return {
        items,
        tabs: s.tabs.map((t) => {
          if (!t.itemId) return t
          const cid = owner.get(t.itemId)
          return cid ? (cid === t.collectionId ? t : { ...t, collectionId: cid }) : { ...t, itemId: null, collectionId: null, dirty: true }
        })
      }
    })
  },
  closeSaveDialog() {
    set({ saveDialogTabKey: null })
  },
  async saveActiveAs(name, collectionId, parentId) {
    const key = get().saveDialogTabKey ?? get().activeTabKey
    const tab = get().tabs.find((t) => t.key === key)
    if (!tab) return
    const n = name.trim() || 'New Request'
    const doc = { ...tab.doc, name: n }
    const item = await api.invoke('items:create', { collectionId, parentId, kind: 'request', name: n, method: doc.request.method })
    await api.invoke('items:saveRequest', item.id, doc)
    set((s) => ({
      saveDialogTabKey: null,
      items: { ...s.items, [collectionId]: [...(s.items[collectionId] ?? []), item] },
      tabs: s.tabs.map((t) => (t.key === tab.key ? { ...t, itemId: item.id, collectionId, doc, dirty: false } : t))
    }))
    get().expand([collectionId, ...(parentId ? [parentId] : [])])
  }
}))

export const methodClass = (m: HttpMethod | null | undefined): string => `m-${(m ?? 'GET').toLowerCase()}`

/** Mantém a tabela de Params e a URL em sincronia (os dois sentidos). */
export function parseQuery(raw: string): KeyValue[] {
  const q = raw.indexOf('?')
  if (q < 0) return []
  return raw
    .slice(q + 1)
    .split('&')
    .filter((p) => p.length > 0)
    .map((p) => {
      const eq = p.indexOf('=')
      return eq < 0 ? { key: p, value: '' } : { key: p.slice(0, eq), value: p.slice(eq + 1) }
    })
}

export function withQuery(raw: string, params: KeyValue[]): string {
  const base = raw.split('?')[0]
  const qs = params
    .filter((p) => !p.disabled && (p.key || p.value))
    .map((p) => (p.value === '' ? p.key : `${p.key}=${p.value}`))
    .join('&')
  return qs ? `${base}?${qs}` : base
}

/** Ajusta documentos antigos ao formato atual (ex.: modo 'binary' -> 'file'). */
export function normalizeDoc(doc: RequestDoc): RequestDoc {
  const body = doc.request.body
  if (body && (body.mode as string) === 'binary') return { ...doc, request: { ...doc.request, body: { ...body, mode: 'file' } } }
  if (!body) return { ...doc, request: { ...doc.request, body: { mode: 'none' } } }
  return doc
}

let expandTimer: ReturnType<typeof setTimeout> | undefined
function persistExpanded() {
  clearTimeout(expandTimer)
  expandTimer = setTimeout(() => api.invoke('state:set', 'expanded', useStore.getState().expanded), 300)
}

/** Caminho "Collection / Pasta / Sub" até o item (sem o próprio item). */
export function itemPath(items: TreeItem[], itemId: string | null): string[] {
  if (!itemId) return []
  const byId = new Map(items.map((i) => [i.id, i]))
  const out: string[] = []
  let cur = byId.get(itemId)?.parentId ?? null
  while (cur) {
    const f = byId.get(cur)
    if (!f) break
    out.unshift(f.name)
    cur = f.parentId
  }
  return out
}

/** Variáveis visíveis para uma aba (globals, collection da aba e environment ativo), para destacar e autocompletar. */
export function lookupFor(s: Pick<State, 'globals' | 'collections' | 'environments' | 'activeEnvId'>, collectionId: string | null): Lookup {
  const scopes: Scope[] = [{ name: 'global', values: s.globals }]
  const col = collectionId ? s.collections.find((c) => c.id === collectionId) : undefined
  if (col) scopes.push({ name: 'collection', values: col.variables })
  const env = s.activeEnvId ? s.environments.find((e) => e.id === s.activeEnvId) : undefined
  if (env) scopes.push({ name: 'environment', values: env.values })
  return makeLookup(scopes)
}
