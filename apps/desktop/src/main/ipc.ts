import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { IpcChannel, IpcContract } from '@shared/types'
import type { Repo } from './db'
import { cancel, send } from './http'
import { makeLookup, resolveDoc, type Scope } from '@shared/variables'
import { countRequests, exportCollection, exportEnvironment, parsePostman, safeFileName } from '@shared/postman'
import { looksLikeCurl, parseCurl } from '@shared/curl'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { ImportResult } from '@shared/types'

type Handlers = {
  [K in IpcChannel]: (...args: IpcContract[K]['args']) => IpcContract[K]['ret'] | Promise<IpcContract[K]['ret']>
}

export function registerIpc(repo: Repo, dbPath: string): void {
  const handlers: Handlers = {
    'app:info': () => ({ version: app.getVersion(), dbPath, electron: process.versions.electron }),
    'app:setTheme': (theme) => {
      const dark = theme === 'dark'
      for (const win of BrowserWindow.getAllWindows()) {
        win.setBackgroundColor(dark ? '#1e1e1e' : '#ffffff')
        win.setTitleBarOverlay?.({ color: dark ? '#1e1e1e' : '#ffffff', symbolColor: dark ? '#c8c8c8' : '#3a3a3a' })
      }
    },
    'collections:list': () => repo.listCollections(),
    'collections:create': (name) => repo.createCollection(name),
    'collections:rename': (id, name) => repo.renameCollection(id, name),
    'collections:delete': (id) => repo.deleteCollection(id),
    'collections:duplicate': (id) => repo.duplicateCollection(id),
    'items:list': (collectionId) => repo.listItems(collectionId),
    'items:create': (input) => repo.createItem(input),
    'items:rename': (id, name) => repo.renameItem(id, name),
    'items:delete': (id) => repo.deleteItem(id),
    'items:move': (id, collectionId, parentId, beforeId) => repo.moveItem(id, collectionId, parentId, beforeId),
    'items:duplicate': (id) => repo.duplicateItem(id),
    'items:get': (id) => repo.getRequest(id),
    'items:saveRequest': (id, doc) => repo.saveRequest(id, doc),
    'environments:list': () => repo.listEnvironments(),
    'environments:create': (name) => repo.createEnvironment(name),
    'environments:delete': (id) => repo.deleteEnvironment(id),
    'environments:update': (id, patch) => repo.updateEnvironment(id, patch),
    'environments:duplicate': (id) => repo.duplicateEnvironment(id),
    'globals:get': () => repo.getGlobals(),
    'globals:set': (values) => repo.setGlobals(values),
    'collections:setVariables': (id, values) => repo.setCollectionVariables(id, values),
    'import:text': (text, fileName) => importText(repo, text, fileName),
    'import:pickFiles': async () => {
      const win = BrowserWindow.getFocusedWindow()
      const opts: Electron.OpenDialogOptions = {
        title: 'Importar',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Postman (JSON)', extensions: ['json'] }, { name: 'Todos', extensions: ['*'] }]
      }
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (r.canceled) return []
      return Promise.all(r.filePaths.map(async (p) => ({ name: basename(p), text: await readFile(p, 'utf8') })))
    },
    'export:collection': async (id, version) => {
      const data = repo.exportCollectionData(id)
      const json = exportCollection(data, version)
      return saveJson(`${safeFileName(data.name)}.postman_collection.json`, json)
    },
    'export:environment': async (id) => {
      const e = repo.getEnvironment(id)
      if (!e) throw new Error('Environment não encontrado')
      return saveJson(`${safeFileName(e.name)}.postman_environment.json`, exportEnvironment(e, 'environment', app.getVersion()))
    },
    'export:globals': async () =>
      saveJson('workspace.postman_globals.json', exportEnvironment({ id: 'globals', name: 'Globals', values: repo.getGlobals() }, 'globals', app.getVersion())),
    'state:get': (key) => repo.getState(key),
    'state:set': (key, value) => repo.setState(key, value),
    'http:send': async (input) => {
      const scopes: Scope[] = [{ name: 'global', values: repo.getGlobals() }]
      if (input.collectionId) scopes.push({ name: 'collection', values: repo.getCollectionVariables(input.collectionId) })
      const env = input.environmentId ? repo.getEnvironment(input.environmentId) : null
      if (env) scopes.push({ name: 'environment', values: env.values })
      const resolved = { ...input, doc: resolveDoc(input.doc, makeLookup(scopes)) }
      const result = await send(resolved, app.getVersion())
      if (!(!result.ok && result.cancelled)) {
        repo.addHistory(
          input.doc,
          result.ok
            ? { status: result.response.status, timeMs: Math.round(result.response.timings.total) }
            : { status: null, timeMs: null, error: result.error }
        )
      }
      return result
    },
    'http:cancel': (requestId) => cancel(requestId),
    'dialog:openFiles': async (multi) => {
      const win = BrowserWindow.getFocusedWindow()
      const opts: Electron.OpenDialogOptions = { properties: multi ? ['openFile', 'multiSelections'] : ['openFile'] }
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      return r.canceled ? [] : r.filePaths
    },
    'history:list': (limit) => repo.listHistory(limit),
    'history:get': (id) => repo.getHistory(id),
    'history:clear': () => repo.clearHistory()
  }

  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    const fn = handlers[channel] as (...a: unknown[]) => unknown
    ipcMain.handle(channel, (_event, ...args: unknown[]) => fn(...args))
  }
}

async function saveJson(defaultName: string, data: unknown): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow()
  const opts: Electron.SaveDialogOptions = {
    title: 'Exportar',
    defaultPath: defaultName,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (r.canceled || !r.filePath) return null
  await writeFile(r.filePath, JSON.stringify(data, null, '\t'), 'utf8')
  return r.filePath
}

/** Reconhece e importa um texto: collection, environment, globals (JSON do Postman) ou comando cURL. */
function importText(repo: Repo, text: string, fileName: string | null): ImportResult {
  const name = fileName ?? 'texto colado'
  try {
    const t = text.replace(/^\uFEFF/, '').trim()
    if (!t) throw new Error('Vazio')
    if (looksLikeCurl(t)) {
      const doc = parseCurl(t)
      return { ok: true, kind: 'curl', name, doc }
    }
    let json: unknown
    try {
      json = JSON.parse(t)
    } catch {
      throw new Error('Não é JSON válido nem um comando cURL')
    }
    const p = parsePostman(json)
    if (p.kind === 'collection') {
      const collection = repo.importCollection(p.data)
      const n = countRequests(p.data.items)
      return { ok: true, kind: 'collection', name, collection, folders: n.folders, requests: n.requests, version: p.version }
    }
    if (p.kind === 'environment') return { ok: true, kind: 'environment', name, environment: repo.createEnvironment(p.data.name, p.data.values) }
    const globals = repo.mergeGlobals(p.data.values)
    return { ok: true, kind: 'globals', name, count: p.data.values.length, globals }
  } catch (err) {
    return { ok: false, name, error: (err as Error).message }
  }
}
