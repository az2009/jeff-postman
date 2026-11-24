/**
 * Conversão entre o formato do Postman (Collection v2.0.0 / v2.1.0, environment e globals) e o modelo
 * interno. Tudo puro (sem Node nem DOM) para rodar no main, no renderer e nos testes.
 */
import type { FolderDoc, KeyValue, PmAuth, PmEvent, QueryParam, RequestBody, RequestDoc, HttpMethod } from './types'

export const SCHEMA_V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
export const SCHEMA_V20 = 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json'
export type PmVersion = '2.1' | '2.0'

// ---------- modelo intermediário ----------
export interface ImportedCollection {
  name: string
  description?: unknown
  auth?: PmAuth
  event?: PmEvent[]
  variables: KeyValue[]
  /** info original menos name/schema/_postman_id, para preservar campos extras */
  infoExtra: Record<string, unknown>
  items: ImportedNode[]
}

export type ImportedNode =
  | { kind: 'folder'; name: string; folder: FolderDoc; children: ImportedNode[] }
  | { kind: 'request'; name: string; doc: RequestDoc }

export type ImportedEnvironment = { name: string; values: KeyValue[] }

export type ParsedImport =
  | { kind: 'collection'; version: PmVersion; data: ImportedCollection }
  | { kind: 'environment'; data: ImportedEnvironment }
  | { kind: 'globals'; data: ImportedEnvironment }

// ---------- utilidades ----------
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const strVal = (v: unknown): string => (v === undefined || v === null ? '' : typeof v === 'string' ? v : String(v))

/** auth v2.0 ({ bearer: { token } }) → v2.1 ({ bearer: [{ key, value, type }] }) */
export function authToV21(auth: unknown): PmAuth | undefined {
  if (!isObj(auth) || typeof auth.type !== 'string') return undefined
  const out: PmAuth = { type: auth.type }
  for (const [k, v] of Object.entries(auth)) {
    if (k === 'type') continue
    if (Array.isArray(v)) out[k] = v
    else if (isObj(v)) out[k] = Object.entries(v).map(([key, value]) => ({ key, value, type: typeof value === 'string' ? 'string' : 'any' }))
    else out[k] = v
  }
  return out
}

/** auth v2.1 → v2.0 */
export function authToV20(auth: PmAuth | undefined): Record<string, unknown> | undefined {
  if (!auth) return undefined
  const out: Record<string, unknown> = { type: auth.type }
  for (const [k, v] of Object.entries(auth)) {
    if (k === 'type') continue
    if (Array.isArray(v)) out[k] = Object.fromEntries(v.filter(isObj).map((p) => [String(p.key), p.value]))
    else out[k] = v
  }
  return out
}

function normEvents(ev: unknown): PmEvent[] | undefined {
  if (!Array.isArray(ev) || ev.length === 0) return undefined
  return ev.filter(isObj).map((e) => {
    const script = isObj(e.script) ? e.script : {}
    const exec = Array.isArray(script.exec) ? script.exec.map(strVal) : typeof script.exec === 'string' ? script.exec.split(/\r?\n/) : []
    return { ...e, listen: strVal(e.listen), script: { ...script, exec } } as PmEvent
  })
}

function normVars(v: unknown): KeyValue[] {
  if (!Array.isArray(v)) return []
  return v.filter(isObj).map((x) => {
    const kv: KeyValue = { key: strVal(x.key ?? x.id), value: strVal(x.value) }
    if (x.disabled === true || x.enabled === false) kv.disabled = true
    if (x.type === 'secret') kv.type = 'secret'
    if (typeof x.description === 'string' && x.description) kv.description = x.description
    return kv
  })
}

function normHeaders(h: unknown): KeyValue[] {
  if (typeof h === 'string')
    return h
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => {
        const disabled = l.startsWith('//')
        const line = disabled ? l.slice(2) : l
        const i = line.indexOf(':')
        const kv: KeyValue = i < 0 ? { key: line.trim(), value: '' } : { key: line.slice(0, i).trim(), value: line.slice(i + 1).trim() }
        if (disabled) kv.disabled = true
        return kv
      })
  if (!Array.isArray(h)) return []
  return h.filter(isObj).map((x) => {
    const kv: KeyValue = { key: strVal(x.key), value: strVal(x.value) }
    if (x.disabled) kv.disabled = true
    if (typeof x.description === 'string' && x.description) kv.description = x.description
    return kv
  })
}

/** Monta o raw a partir das partes, quando o export não trouxe raw. */
function rawFromParts(u: Record<string, unknown>): string {
  const host = Array.isArray(u.host) ? u.host.join('.') : strVal(u.host)
  const path = Array.isArray(u.path) ? u.path.map((p) => (isObj(p) ? strVal(p.value) : strVal(p))).join('/') : strVal(u.path)
  const query = Array.isArray(u.query)
    ? u.query
        .filter(isObj)
        .filter((q) => !q.disabled)
        .map((q) => (q.value === null || q.value === undefined ? strVal(q.key) : `${strVal(q.key)}=${strVal(q.value)}`))
        .join('&')
    : ''
  const proto = u.protocol ? `${strVal(u.protocol)}://` : ''
  const port = u.port ? `:${strVal(u.port)}` : ''
  return `${proto}${host}${port}${path ? `/${path}` : ''}${query ? `?${query}` : ''}${u.hash ? `#${strVal(u.hash)}` : ''}`
}

function normUrl(u: unknown): RequestDoc['request']['url'] {
  if (typeof u === 'string') return { raw: u }
  if (!isObj(u)) return { raw: '' }
  const url: RequestDoc['request']['url'] = { raw: typeof u.raw === 'string' ? u.raw : rawFromParts(u) }
  const disabled: QueryParam[] = Array.isArray(u.query)
    ? u.query
        .filter(isObj)
        .filter((q) => q.disabled)
        .map((q) => {
          const p: QueryParam = { key: strVal(q.key), value: q.value === null || q.value === undefined ? null : strVal(q.value), disabled: true }
          if (q.description !== undefined) p.description = q.description
          return p
        })
    : []
  if (disabled.length) url.query = disabled
  const vars = normVars(u.variable)
  if (vars.length) url.variable = vars
  return url
}

function normBody(b: unknown): RequestBody | undefined {
  if (!isObj(b) || typeof b.mode !== 'string') return undefined
  // modos que o app ainda não edita (graphql...) ficam como vieram
  const body = { ...b } as RequestBody & Record<string, unknown>
  if (b.mode === 'urlencoded') body.urlencoded = normHeaders(b.urlencoded)
  if (b.mode === 'formdata')
    body.formdata = Array.isArray(b.formdata)
      ? b.formdata.filter(isObj).map((e) => {
          const isFile = e.type === 'file'
          const out: NonNullable<RequestBody['formdata']>[number] = { key: strVal(e.key), type: isFile ? 'file' : 'text' }
          if (isFile) out.src = Array.isArray(e.src) ? e.src.map(strVal) : e.src === undefined || e.src === null ? [] : strVal(e.src)
          else out.value = strVal(e.value)
          if (e.disabled) out.disabled = true
          if (typeof e.contentType === 'string' && e.contentType) out.contentType = e.contentType
          if (typeof e.description === 'string' && e.description) out.description = e.description
          return out
        })
      : []
  if (b.mode === 'raw') {
    body.raw = strVal(b.raw)
    const lang = isObj(b.options) && isObj(b.options.raw) ? b.options.raw.language : undefined
    if (typeof lang === 'string') body.options = { ...(b.options as object), raw: { ...(b.options as { raw: object }).raw, language: lang } } as RequestBody['options']
  }
  if (b.mode === 'file') body.file = { src: isObj(b.file) && b.file.src ? strVal(b.file.src) : null }
  return body
}

function normRequest(it: Record<string, unknown>): RequestDoc {
  const r = it.request
  const name = strVal(it.name) || 'Request'
  const reqObj = typeof r === 'string' ? { url: r } : isObj(r) ? r : {}
  const doc: RequestDoc = {
    name,
    request: {
      method: (strVal(reqObj.method) || 'GET').toUpperCase() as HttpMethod,
      url: normUrl(reqObj.url),
      header: normHeaders(reqObj.header),
      body: normBody(reqObj.body) ?? { mode: 'none' }
    }
  }
  if (reqObj.description !== undefined) doc.request.description = reqObj.description
  const auth = authToV21(reqObj.auth)
  if (auth) doc.request.auth = auth
  const ev = normEvents(it.event)
  if (ev) doc.event = ev
  if (Array.isArray(it.response) && it.response.length) doc.response = it.response
  if (isObj(it.protocolProfileBehavior)) doc.protocolProfileBehavior = it.protocolProfileBehavior
  return doc
}

function normItems(items: unknown): ImportedNode[] {
  if (!Array.isArray(items)) return []
  return items.filter(isObj).map((it): ImportedNode => {
    const name = strVal(it.name) || (Array.isArray(it.item) ? 'Folder' : 'Request')
    if (Array.isArray(it.item)) {
      const folder: FolderDoc = { name }
      if (it.description !== undefined) folder.description = it.description
      const auth = authToV21(it.auth)
      if (auth) folder.auth = auth
      const ev = normEvents(it.event)
      if (ev) folder.event = ev
      const vars = normVars(it.variable)
      if (vars.length) folder.variable = vars
      if (isObj(it.protocolProfileBehavior)) folder.protocolProfileBehavior = it.protocolProfileBehavior
      return { kind: 'folder', name, folder, children: normItems(it.item) }
    }
    return { kind: 'request', name, doc: normRequest(it) }
  })
}

/** Lê um JSON do Postman e diz o que é. Lança erro com mensagem legível quando não reconhece. */
export function parsePostman(json: unknown): ParsedImport {
  if (!isObj(json)) throw new Error('O arquivo não é um objeto JSON')
  // collection
  if (isObj(json.info) && Array.isArray(json.item)) {
    const info = json.info
    const schema = strVal(info.schema)
    let version: PmVersion = '2.1'
    if (schema.includes('v2.0')) version = '2.0'
    else if (schema.includes('v1')) throw new Error('Collection v1 não é suportada; exporte de novo no Postman como v2.1')
    const { name, schema: _s, _postman_id: _id, description, ...infoExtra } = info
    return {
      kind: 'collection',
      version,
      data: {
        name: strVal(name) || 'Imported Collection',
        description: description ?? json.description,
        auth: authToV21(json.auth),
        event: normEvents(json.event),
        variables: normVars(json.variable),
        infoExtra,
        items: normItems(json.item)
      }
    }
  }
  if (Array.isArray(json.requests) && Array.isArray(json.order))
    throw new Error('Collection v1 não é suportada; exporte de novo no Postman como v2.1')
  // environment / globals
  if (Array.isArray(json.values)) {
    const scope = json._postman_variable_scope
    const data = { name: strVal(json.name) || (scope === 'globals' ? 'Globals' : 'Imported Environment'), values: normVars(json.values) }
    return scope === 'globals' ? { kind: 'globals', data } : { kind: 'environment', data }
  }
  throw new Error('Formato não reconhecido (esperado: collection, environment ou globals do Postman)')
}

// ---------- exportação ----------
export interface ExportNode {
  id: string
  kind: 'folder' | 'request'
  name: string
  doc: RequestDoc | FolderDoc | null
  children: ExportNode[]
}

export interface ExportCollectionInput {
  id: string
  name: string
  description?: unknown
  auth?: PmAuth
  event?: PmEvent[]
  variables: KeyValue[]
  infoExtra?: Record<string, unknown>
  items: ExportNode[]
}

/** Separa a URL nas partes que o Postman grava (protocol, host[], port, path[], query[]). */
export function urlParts(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = { raw }
  let rest = raw
  const hashI = rest.indexOf('#')
  if (hashI >= 0) {
    out.hash = rest.slice(hashI + 1)
    rest = rest.slice(0, hashI)
  }
  let qs: string | null = null
  const qI = rest.indexOf('?')
  if (qI >= 0) {
    qs = rest.slice(qI + 1)
    rest = rest.slice(0, qI)
  }
  const pm = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(rest)
  if (pm) {
    out.protocol = pm[1]
    rest = rest.slice(pm[0].length)
  }
  const slash = rest.indexOf('/')
  let hostPart = slash < 0 ? rest : rest.slice(0, slash)
  const portM = /:(\d+|\{\{[^{}]+\}\})$/.exec(hostPart)
  if (portM) {
    out.port = portM[1]
    hostPart = hostPart.slice(0, portM.index)
  }
  if (hostPart) out.host = splitOutsideBraces(hostPart, '.')
  if (slash >= 0) out.path = rest.slice(slash + 1).split('/')
  if (qs !== null)
    out.query = qs
      .split('&')
      .filter((p) => p !== '')
      .map((p) => {
        const i = p.indexOf('=')
        return i < 0 ? { key: p, value: null } : { key: p.slice(0, i), value: p.slice(i + 1) }
      })
  return out
}

function splitOutsideBraces(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith('{{', i)) depth++
    if (s.startsWith('}}', i)) depth = Math.max(0, depth - 1)
    if (s[i] === sep && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += s[i]
  }
  out.push(cur)
  return out
}

const kvOut = (list: KeyValue[] | undefined, withType = true) =>
  (list ?? []).map((kv) => {
    const o: Record<string, unknown> = { key: kv.key, value: kv.value }
    if (withType) o.type = 'text'
    if (kv.disabled) o.disabled = true
    if (kv.description) o.description = kv.description
    return o
  })

function bodyOut(body: RequestBody | undefined): Record<string, unknown> | undefined {
  if (!body || body.mode === 'none') return undefined
  const extra = body as RequestBody & Record<string, unknown>
  switch (body.mode) {
    case 'raw': {
      const o: Record<string, unknown> = { mode: 'raw', raw: body.raw ?? '' }
      if (body.options) o.options = body.options
      return o
    }
    case 'urlencoded':
      return { mode: 'urlencoded', urlencoded: kvOut(body.urlencoded) }
    case 'formdata':
      return {
        mode: 'formdata',
        formdata: (body.formdata ?? []).map((e) => {
          const o: Record<string, unknown> = { key: e.key }
          if (e.type === 'file') {
            o.type = 'file'
            o.src = e.src ?? []
          } else {
            o.value = e.value ?? ''
            o.type = 'text'
          }
          if (e.contentType) o.contentType = e.contentType
          if (e.description) o.description = e.description
          if (e.disabled) o.disabled = true
          return o
        })
      }
    case 'file':
      return { mode: 'file', file: { src: body.file?.src ?? null } }
    default:
      return { ...extra }
  }
}

function urlOut(url: RequestDoc['request']['url']): Record<string, unknown> | undefined {
  if (!url.raw && !url.query?.length && !url.variable?.length) return undefined
  const parts = urlParts(url.raw)
  if (url.query?.length) parts.query = [...((parts.query as unknown[]) ?? []), ...url.query.map((q) => ({ ...q, disabled: true }))]
  if (url.variable?.length)
    parts.variable = url.variable.map((v) => {
      const o: Record<string, unknown> = { key: v.key, value: v.value }
      if (v.description) o.description = v.description
      if (v.disabled) o.disabled = true
      return o
    })
  return parts
}

const authOut = (a: PmAuth | undefined, v: PmVersion) => (a ? (v === '2.0' ? authToV20(a) : a) : undefined)

function itemOut(n: ExportNode, v: PmVersion): Record<string, unknown> {
  if (n.kind === 'folder') {
    const f = (n.doc ?? { name: n.name }) as FolderDoc
    const o: Record<string, unknown> = { name: n.name, item: n.children.map((c) => itemOut(c, v)) }
    if (f.description !== undefined) o.description = f.description
    if (f.auth) o.auth = authOut(f.auth, v)
    if (f.event) o.event = f.event
    if (f.variable?.length) o.variable = f.variable.map((x) => ({ key: x.key, value: x.value, ...(x.disabled ? { disabled: true } : {}) }))
    if (f.protocolProfileBehavior) o.protocolProfileBehavior = f.protocolProfileBehavior
    return o
  }
  const d = n.doc as RequestDoc
  const req: Record<string, unknown> = {}
  if (d.request.auth) req.auth = authOut(d.request.auth, v)
  req.method = d.request.method
  req.header = kvOut(d.request.header)
  const body = bodyOut(d.request.body)
  if (body) req.body = body
  const url = urlOut(d.request.url)
  if (url) req.url = url
  if (d.request.description !== undefined) req.description = d.request.description
  const o: Record<string, unknown> = { name: n.name }
  if (d.event?.length) o.event = d.event
  o.request = req
  o.response = d.response ?? []
  if (d.protocolProfileBehavior) o.protocolProfileBehavior = d.protocolProfileBehavior
  return o
}

/** Gera o JSON da collection no formato do Postman (v2.1 por padrão). */
export function exportCollection(c: ExportCollectionInput, v: PmVersion = '2.1'): Record<string, unknown> {
  const info: Record<string, unknown> = { _postman_id: c.id, name: c.name }
  if (c.description !== undefined && c.description !== null && c.description !== '') info.description = c.description
  info.schema = v === '2.0' ? SCHEMA_V20 : SCHEMA_V21
  Object.assign(info, c.infoExtra ?? {})
  const out: Record<string, unknown> = { info, item: c.items.map((n) => itemOut(n, v)) }
  if (c.auth) out.auth = authOut(c.auth, v)
  if (c.event?.length) out.event = c.event
  if (c.variables.length)
    out.variable = c.variables.map((x) => ({ key: x.key, value: x.value, type: x.type === 'secret' ? 'secret' : 'string', ...(x.disabled ? { disabled: true } : {}) }))
  return out
}

export function exportEnvironment(
  e: { id: string; name: string; values: KeyValue[] },
  scope: 'environment' | 'globals',
  appVersion: string
): Record<string, unknown> {
  return {
    id: e.id,
    name: e.name,
    values: e.values
      .filter((v) => v.key)
      .map((v) => ({ key: v.key, value: v.value, type: v.type === 'secret' ? 'secret' : 'default', enabled: !v.disabled })),
    _postman_variable_scope: scope,
    _postman_exported_at: new Date().toISOString(),
    _postman_exported_using: `JEFF Postman/${appVersion}`
  }
}

export function countRequests(nodes: ImportedNode[]): { folders: number; requests: number } {
  let folders = 0
  let requests = 0
  const walk = (ns: ImportedNode[]) => {
    for (const n of ns) {
      if (n.kind === 'folder') {
        folders++
        walk(n.children)
      } else requests++
    }
  }
  walk(nodes)
  return { folders, requests }
}

export const safeFileName = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'export'

