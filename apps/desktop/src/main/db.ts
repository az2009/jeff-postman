import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'crypto'
import type {
  Collection,
  Environment,
  HistoryEntry,
  HttpMethod,
  KeyValue,
  NewItemInput,
  RequestDoc,
  TreeItem
} from '@shared/types'
import type { ExportCollectionInput, ExportNode, ImportedCollection, ImportedNode } from '@shared/postman'

type DB = DatabaseSync
interface ItemRow {
  id: string
  collection_id: string
  parent_id: string | null
  kind: 'folder' | 'request'
  name: string
  method: string | null
  sort_order: number
  body_json: string | null
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    auth_json TEXT,
    variables_json TEXT,
    events_json TEXT,
    info_json TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES items(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('folder','request')),
    name TEXT NOT NULL,
    method TEXT,
    sort_order REAL NOT NULL,
    body_json TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_items_tree ON items(collection_id, parent_id, sort_order);
  CREATE TABLE environments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    values_json TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE globals (id INTEGER PRIMARY KEY CHECK (id = 1), values_json TEXT NOT NULL DEFAULT '[]');
  INSERT INTO globals (id) VALUES (1);
  CREATE TABLE active_state (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_json TEXT NOT NULL,
    response_meta_json TEXT,
    response_body BLOB,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_history_created ON history(created_at DESC);
  CREATE TABLE runs (id TEXT PRIMARY KEY, collection_id TEXT, started_at INTEGER, config_json TEXT, summary_json TEXT);
  CREATE TABLE run_results (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    iteration INTEGER, item_id TEXT, status INTEGER, time_ms REAL,
    tests_json TEXT, request_json TEXT, response_meta_json TEXT
  );
  CREATE TABLE oauth_tokens (id TEXT PRIMARY KEY, scope_key TEXT, name TEXT, token_enc BLOB, expires_at INTEGER);
  CREATE TABLE cookies (domain TEXT, path TEXT, name TEXT, value TEXT, json TEXT, PRIMARY KEY (domain, path, name));
  `
]

function migrate(db: DB): void {
  const current = (db.prepare('PRAGMA user_version').get() as unknown as { user_version: number }).user_version
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

function defaultRequest(name: string, method: HttpMethod): RequestDoc {
  return { name, request: { method, url: { raw: '' }, header: [], body: { mode: 'none' } } }
}

export class Repo {
  readonly db: DB

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;')
    migrate(this.db)
  }

  // ---------- collections ----------
  listCollections(): Collection[] {
    const rows = this.db
      .prepare('SELECT id, name, updated_at AS updatedAt, variables_json FROM collections ORDER BY name COLLATE NOCASE')
      .all() as unknown as { id: string; name: string; updatedAt: number; variables_json: string | null }[]
    return rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt, variables: parseKv(r.variables_json) }))
  }

  getCollectionVariables(id: string): KeyValue[] {
    const row = this.db.prepare('SELECT variables_json FROM collections WHERE id = ?').get(id) as unknown as
      | { variables_json: string | null }
      | undefined
    return parseKv(row?.variables_json ?? null)
  }

  setCollectionVariables(id: string, values: KeyValue[]): void {
    this.db.prepare('UPDATE collections SET variables_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(values), Date.now(), id)
  }

  getGlobals(): KeyValue[] {
    const row = this.db.prepare('SELECT values_json FROM globals WHERE id = 1').get() as unknown as { values_json: string } | undefined
    return parseKv(row?.values_json ?? null)
  }

  setGlobals(values: KeyValue[]): void {
    this.db.prepare('UPDATE globals SET values_json = ? WHERE id = 1').run(JSON.stringify(values))
  }

  createCollection(name: string): Collection {
    const c: Collection = { id: randomUUID(), name: name.trim() || 'New Collection', updatedAt: Date.now(), variables: [] }
    this.db
      .prepare('INSERT INTO collections (id, name, info_json, updated_at) VALUES (?, ?, ?, ?)')
      .run(c.id, c.name, JSON.stringify({ _postman_id: c.id, name: c.name }), c.updatedAt)
    return c
  }

  renameCollection(id: string, name: string): void {
    this.db.prepare('UPDATE collections SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id)
  }

  deleteCollection(id: string): void {
    this.db.prepare('DELETE FROM collections WHERE id = ?').run(id)
  }

  // ---------- items ----------
  listItems(collectionId: string): TreeItem[] {
    return this.db
      .prepare(
        `SELECT id, collection_id AS collectionId, parent_id AS parentId, kind, name, method, sort_order AS sortOrder
         FROM items WHERE collection_id = ? ORDER BY sort_order`
      )
      .all(collectionId) as unknown as TreeItem[]
  }

  createItem(input: NewItemInput): TreeItem {
    const id = randomUUID()
    const now = Date.now()
    const max = this.db
      .prepare('SELECT MAX(sort_order) AS m FROM items WHERE collection_id = ? AND parent_id IS ?')
      .get(input.collectionId, input.parentId) as unknown as { m: number | null }
    const sortOrder = (max.m ?? 0) + 1
    const method = input.kind === 'request' ? (input.method ?? 'GET') : null
    const body = input.kind === 'request' ? JSON.stringify(defaultRequest(input.name, method!)) : null
    this.db
      .prepare(
        `INSERT INTO items (id, collection_id, parent_id, kind, name, method, sort_order, body_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.collectionId, input.parentId, input.kind, input.name, method, sortOrder, body, now)
    this.touchCollection(input.collectionId)
    return { id, collectionId: input.collectionId, parentId: input.parentId, kind: input.kind, name: input.name, method, sortOrder }
  }

  renameItem(id: string, name: string): void {
    const row = this.db.prepare('SELECT body_json FROM items WHERE id = ?').get(id) as unknown as { body_json: string | null } | undefined
    if (!row) return
    let body = row.body_json
    if (body) {
      const doc = JSON.parse(body) as RequestDoc
      doc.name = name
      body = JSON.stringify(doc)
    }
    this.db.prepare('UPDATE items SET name = ?, body_json = ?, updated_at = ? WHERE id = ?').run(name, body, Date.now(), id)
  }

  deleteItem(id: string): void {
    this.db.prepare('DELETE FROM items WHERE id = ?').run(id)
  }

  getRequest(id: string): RequestDoc | null {
    const row = this.db.prepare("SELECT body_json FROM items WHERE id = ? AND kind = 'request'").get(id) as unknown as
      | { body_json: string | null }
      | undefined
    return row?.body_json ? (JSON.parse(row.body_json) as RequestDoc) : null
  }

  saveRequest(id: string, doc: RequestDoc): void {
    const info = this.db
      .prepare("UPDATE items SET name = ?, method = ?, body_json = ?, updated_at = ? WHERE id = ? AND kind = 'request'")
      .run(doc.name, doc.request.method, JSON.stringify(doc), Date.now(), id)
    if (info.changes === 0) throw new Error(`Requisição ${id} não encontrada`)
  }

  private touchCollection(id: string): void {
    this.db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(Date.now(), id)
  }

  // ---------- environments ----------
  listEnvironments(): Environment[] {
    const rows = this.db
      .prepare('SELECT id, name, values_json, updated_at AS updatedAt FROM environments ORDER BY name COLLATE NOCASE')
      .all() as unknown as { id: string; name: string; values_json: string; updatedAt: number }[]
    return rows.map((r) => ({ id: r.id, name: r.name, values: JSON.parse(r.values_json), updatedAt: r.updatedAt }))
  }

  createEnvironment(name: string, values: KeyValue[] = []): Environment {
    const e: Environment = { id: randomUUID(), name: name.trim() || 'New Environment', values, updatedAt: Date.now() }
    this.db
      .prepare('INSERT INTO environments (id, name, values_json, updated_at) VALUES (?, ?, ?, ?)')
      .run(e.id, e.name, JSON.stringify(values), e.updatedAt)
    return e
  }

  /** Globals importadas: mesmo nome substitui, nome novo entra no fim. */
  mergeGlobals(values: KeyValue[]): KeyValue[] {
    const cur = this.getGlobals()
    for (const v of values) {
      const i = cur.findIndex((c) => c.key === v.key)
      if (i >= 0) cur[i] = v
      else cur.push(v)
    }
    this.setGlobals(cur)
    return cur
  }

  // ---------- importar e exportar collection ----------
  importCollection(data: ImportedCollection): Collection {
    return this.tx(() => {
      const c: Collection = { id: randomUUID(), name: data.name, updatedAt: Date.now(), variables: data.variables }
      this.db
        .prepare(
          `INSERT INTO collections (id, name, description, auth_json, variables_json, events_json, info_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          c.id,
          c.name,
          data.description === undefined ? null : JSON.stringify(data.description),
          data.auth ? JSON.stringify(data.auth) : null,
          JSON.stringify(data.variables),
          data.event ? JSON.stringify(data.event) : null,
          JSON.stringify(data.infoExtra ?? {}),
          c.updatedAt
        )
      const insert = this.db.prepare(
        `INSERT INTO items (id, collection_id, parent_id, kind, name, method, sort_order, body_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const walk = (nodes: ImportedNode[], parentId: string | null) => {
        nodes.forEach((n, i) => {
          const id = randomUUID()
          if (n.kind === 'folder') {
            insert.run(id, c.id, parentId, 'folder', n.name, null, i + 1, JSON.stringify(n.folder), c.updatedAt)
            walk(n.children, id)
          } else {
            insert.run(id, c.id, parentId, 'request', n.name, n.doc.request.method, i + 1, JSON.stringify(n.doc), c.updatedAt)
          }
        })
      }
      walk(data.items, null)
      return c
    })
  }

  exportCollectionData(id: string): ExportCollectionInput {
    const row = this.db
      .prepare('SELECT id, name, description, auth_json, variables_json, events_json, info_json FROM collections WHERE id = ?')
      .get(id) as unknown as
      | { id: string; name: string; description: string | null; auth_json: string | null; variables_json: string | null; events_json: string | null; info_json: string | null }
      | undefined
    if (!row) throw new Error('Collection não encontrada')
    const rows = this.db
      .prepare('SELECT id, parent_id, kind, name, body_json FROM items WHERE collection_id = ? ORDER BY sort_order')
      .all(id) as unknown as { id: string; parent_id: string | null; kind: 'folder' | 'request'; name: string; body_json: string | null }[]
    const nodes = new Map<string, ExportNode>()
    for (const r of rows) {
      const doc = r.body_json ? JSON.parse(r.body_json) : null
      // o nome da árvore manda (renomear pela árvore não reescreve o body de pasta antigo)
      if (doc) doc.name = r.name
      nodes.set(r.id, { id: r.id, kind: r.kind, name: r.name, doc, children: [] })
    }
    const roots: ExportNode[] = []
    for (const r of rows) {
      const n = nodes.get(r.id)!
      if (r.parent_id && nodes.has(r.parent_id)) nodes.get(r.parent_id)!.children.push(n)
      else roots.push(n)
    }
    const info = row.info_json ? JSON.parse(row.info_json) : {}
    // info_json antigo (fase 0) tinha _postman_id/name: não repetir
    delete info._postman_id
    delete info.name
    delete info.schema
    return {
      id: row.id,
      name: row.name,
      description: row.description ? JSON.parse(row.description) : undefined,
      auth: row.auth_json ? JSON.parse(row.auth_json) : undefined,
      event: row.events_json ? JSON.parse(row.events_json) : undefined,
      variables: parseKv(row.variables_json),
      infoExtra: info,
      items: roots
    }
  }

  getEnvironment(id: string): Environment | null {
    return this.listEnvironments().find((e) => e.id === id) ?? null
  }

  updateEnvironment(id: string, patch: { name?: string; values?: KeyValue[] }): Environment {
    const cur = this.getEnvironment(id)
    if (!cur) throw new Error('Environment não encontrado')
    const next: Environment = {
      ...cur,
      name: patch.name?.trim() || cur.name,
      values: patch.values ?? cur.values,
      updatedAt: Date.now()
    }
    this.db
      .prepare('UPDATE environments SET name = ?, values_json = ?, updated_at = ? WHERE id = ?')
      .run(next.name, JSON.stringify(next.values), next.updatedAt, id)
    return next
  }

  duplicateEnvironment(id: string): Environment {
    const cur = this.getEnvironment(id)
    if (!cur) throw new Error('Environment não encontrado')
    const e: Environment = { id: randomUUID(), name: `${cur.name} Copy`, values: cur.values, updatedAt: Date.now() }
    this.db
      .prepare('INSERT INTO environments (id, name, values_json, updated_at) VALUES (?, ?, ?, ?)')
      .run(e.id, e.name, JSON.stringify(e.values), e.updatedAt)
    return e
  }

  deleteEnvironment(id: string): void {
    this.db.prepare('DELETE FROM environments WHERE id = ?').run(id)
  }

  // ---------- mover e duplicar ----------
  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const r = fn()
      this.db.exec('COMMIT')
      return r
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  private itemRow(id: string): ItemRow | undefined {
    return this.db.prepare('SELECT * FROM items WHERE id = ?').get(id) as unknown as ItemRow | undefined
  }

  /** Id do item e de todos os descendentes. */
  private subtreeIds(id: string): string[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT i.id FROM items i JOIN sub ON i.parent_id = sub.id)
         SELECT id FROM sub`
      )
      .all(id) as unknown as { id: string }[]
    return rows.map((r) => r.id)
  }

  /** Renumera os irmãos de um pai (1, 2, 3...) na ordem dada. */
  private renumber(ids: string[]): void {
    const st = this.db.prepare('UPDATE items SET sort_order = ? WHERE id = ?')
    ids.forEach((id, i) => st.run(i + 1, id))
  }

  private siblings(collectionId: string, parentId: string | null): string[] {
    const rows = this.db
      .prepare('SELECT id FROM items WHERE collection_id = ? AND parent_id IS ? ORDER BY sort_order')
      .all(collectionId, parentId) as unknown as { id: string }[]
    return rows.map((r) => r.id)
  }

  /**
   * Move um item (e a subárvore) para outro pai/collection, antes de `beforeId` (ou no fim).
   * Recusa mover uma pasta para dentro dela mesma.
   */
  moveItem(id: string, collectionId: string, parentId: string | null, beforeId: string | null): void {
    this.tx(() => {
      const row = this.itemRow(id)
      if (!row) throw new Error('Item não encontrado')
      const sub = this.subtreeIds(id)
      if (parentId && sub.includes(parentId)) throw new Error('Não dá para mover uma pasta para dentro dela mesma')
      if (parentId) {
        const p = this.itemRow(parentId)
        if (!p || p.kind !== 'folder' || p.collection_id !== collectionId) throw new Error('Pasta de destino inválida')
      }
      if (row.collection_id !== collectionId) {
        const st = this.db.prepare('UPDATE items SET collection_id = ? WHERE id = ?')
        for (const sid of sub) st.run(collectionId, sid)
        this.touchCollection(row.collection_id)
      }
      this.db.prepare('UPDATE items SET parent_id = ?, updated_at = ? WHERE id = ?').run(parentId, Date.now(), id)
      const sibs = this.siblings(collectionId, parentId).filter((s) => s !== id)
      const at = beforeId ? sibs.indexOf(beforeId) : -1
      sibs.splice(at < 0 ? sibs.length : at, 0, id)
      this.renumber(sibs)
      if (row.collection_id !== collectionId || parentId !== row.parent_id) this.renumber(this.siblings(row.collection_id, row.parent_id))
      this.touchCollection(collectionId)
    })
  }

  /** Copia a subárvore de `rootId` para `collectionId`/`parentId`. Devolve o id da cópia da raiz. */
  private copySubtree(rootId: string, collectionId: string, parentId: string | null, rootName?: string): string {
    const ids = this.subtreeIds(rootId)
    const map = new Map<string, string>()
    for (const old of ids) map.set(old, randomUUID())
    const insert = this.db.prepare(
      `INSERT INTO items (id, collection_id, parent_id, kind, name, method, sort_order, body_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const now = Date.now()
    for (const old of ids) {
      const r = this.itemRow(old)!
      const isRoot = old === rootId
      const name = isRoot && rootName ? rootName : r.name
      let body = r.body_json
      if (body && isRoot && rootName) {
        const doc = JSON.parse(body) as RequestDoc
        doc.name = name
        body = JSON.stringify(doc)
      }
      insert.run(
        map.get(old)!,
        collectionId,
        isRoot ? parentId : map.get(r.parent_id!)!,
        r.kind,
        name,
        r.method,
        r.sort_order,
        body,
        now
      )
    }
    return map.get(rootId)!
  }

  duplicateItem(id: string): string {
    return this.tx(() => {
      const row = this.itemRow(id)
      if (!row) throw new Error('Item não encontrado')
      const copyId = this.copySubtree(id, row.collection_id, row.parent_id, `${row.name} Copy`)
      const sibs = this.siblings(row.collection_id, row.parent_id).filter((s) => s !== copyId)
      sibs.splice(sibs.indexOf(id) + 1, 0, copyId)
      this.renumber(sibs)
      this.touchCollection(row.collection_id)
      return copyId
    })
  }

  duplicateCollection(id: string): Collection {
    return this.tx(() => {
      const src = this.db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as unknown as
        | { name: string; description: string | null; auth_json: string | null; variables_json: string | null; events_json: string | null }
        | undefined
      if (!src) throw new Error('Collection não encontrada')
      const c: Collection = { id: randomUUID(), name: `${src.name} Copy`, updatedAt: Date.now(), variables: parseKv(src.variables_json) }
      this.db
        .prepare(
          `INSERT INTO collections (id, name, description, auth_json, variables_json, events_json, info_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(c.id, c.name, src.description, src.auth_json, src.variables_json, src.events_json, JSON.stringify({ _postman_id: c.id, name: c.name }), c.updatedAt)
      for (const rootId of this.siblings(id, null)) this.copySubtree(rootId, c.id, null)
      return c
    })
  }

  // ---------- history ----------
  addHistory(doc: RequestDoc, meta: { status: number | null; timeMs: number | null; error?: string }): void {
    this.db
      .prepare('INSERT INTO history (request_json, response_meta_json, created_at) VALUES (?, ?, ?)')
      .run(JSON.stringify(doc), JSON.stringify(meta), Date.now())
    // guarda as 1000 mais recentes
    this.db.exec('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 1000)')
  }

  listHistory(limit: number): HistoryEntry[] {
    const rows = this.db
      .prepare('SELECT id, request_json, response_meta_json, created_at FROM history ORDER BY id DESC LIMIT ?')
      .all(Math.max(1, Math.min(limit, 1000))) as unknown as {
      id: number
      request_json: string
      response_meta_json: string | null
      created_at: number
    }[]
    return rows.map((r) => {
      const doc = JSON.parse(r.request_json) as RequestDoc
      const meta = r.response_meta_json ? JSON.parse(r.response_meta_json) : {}
      return {
        id: r.id,
        name: doc.name,
        method: doc.request.method,
        url: doc.request.url.raw,
        status: meta.status ?? null,
        timeMs: meta.timeMs ?? null,
        createdAt: r.created_at
      }
    })
  }

  getHistory(id: number): RequestDoc | null {
    const row = this.db.prepare('SELECT request_json FROM history WHERE id = ?').get(id) as unknown as
      | { request_json: string }
      | undefined
    return row ? (JSON.parse(row.request_json) as RequestDoc) : null
  }

  clearHistory(): void {
    this.db.exec('DELETE FROM history')
  }

  // ---------- state ----------
  getState(key: string): unknown {
    const row = this.db.prepare('SELECT value FROM active_state WHERE key = ?').get(key) as unknown as { value: string } | undefined
    return row ? JSON.parse(row.value) : null
  }

  setState(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO active_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value ?? null))
  }

  close(): void {
    this.db.close()
  }
}

function parseKv(json: string | null): KeyValue[] {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? (v as KeyValue[]) : []
  } catch {
    return []
  }
}
