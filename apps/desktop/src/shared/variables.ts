import type { KeyValue, RequestBody, RequestDoc } from './types'

/** Escopos do Postman, do mais fraco ao mais forte: global < collection < environment < data < local. */
export const SCOPE_ORDER = ['global', 'collection', 'environment', 'data', 'local'] as const
export type ScopeName = (typeof SCOPE_ORDER)[number]

export interface Scope {
  name: ScopeName
  values: KeyValue[]
}

export interface VarInfo {
  value: string
  scope: ScopeName
  secret: boolean
}

export type Lookup = Map<string, VarInfo>

const MAX_DEPTH = 10
const VAR_RE = /\{\{([^{}]+?)\}\}/g

/** Monta o mapa nome → valor respeitando a precedência (ordem de `scopes` não importa). */
export function makeLookup(scopes: Scope[]): Lookup {
  const sorted = [...scopes].sort((a, b) => SCOPE_ORDER.indexOf(a.name) - SCOPE_ORDER.indexOf(b.name))
  const out: Lookup = new Map()
  for (const sc of sorted) {
    for (const v of sc.values) {
      if (v.disabled || !v.key) continue
      out.set(v.key, { value: v.value ?? '', scope: sc.name, secret: v.type === 'secret' })
    }
  }
  return out
}

// ---------- variáveis dinâmicas ($guid, $timestamp...) ----------
const FIRST = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Felipe', 'Gabriela', 'Heitor', 'Isabela', 'João', 'Larissa', 'Marcos']
const LAST = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Lima', 'Costa', 'Pereira', 'Almeida', 'Ribeiro', 'Gomes']
const COLORS = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'black', 'white', 'gray', 'pink']
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)]
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
const alnum = 'abcdefghijklmnopqrstuvwxyz0123456789'

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export const DYNAMIC: Record<string, { gen(): string; doc: string }> = {
  $guid: { gen: uuid, doc: 'UUID v4' },
  $randomUUID: { gen: uuid, doc: 'UUID v4' },
  $timestamp: { gen: () => String(Math.floor(Date.now() / 1000)), doc: 'Unix timestamp (segundos)' },
  $isoTimestamp: { gen: () => new Date().toISOString(), doc: 'Data e hora ISO 8601 (UTC)' },
  $randomInt: { gen: () => String(randInt(0, 1000)), doc: 'Inteiro de 0 a 1000' },
  $randomBoolean: { gen: () => String(Math.random() < 0.5), doc: 'true ou false' },
  $randomAlphaNumeric: { gen: () => alnum[randInt(0, alnum.length - 1)], doc: 'Um caractere alfanumérico' },
  $randomFirstName: { gen: () => pick(FIRST), doc: 'Primeiro nome' },
  $randomLastName: { gen: () => pick(LAST), doc: 'Sobrenome' },
  $randomFullName: { gen: () => `${pick(FIRST)} ${pick(LAST)}`, doc: 'Nome completo' },
  $randomEmail: {
    gen: () => `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase()}${randInt(1, 999)}@example.com`,
    doc: 'E-mail'
  },
  $randomColor: { gen: () => pick(COLORS), doc: 'Nome de cor' },
  $randomIP: { gen: () => [0, 0, 0, 0].map(() => randInt(1, 254)).join('.'), doc: 'Endereço IPv4' },
  $randomPhoneNumber: { gen: () => `${randInt(200, 999)}-${randInt(200, 999)}-${randInt(1000, 9999)}`, doc: 'Telefone' }
}

export const isDynamic = (name: string) => Object.prototype.hasOwnProperty.call(DYNAMIC, name)

/**
 * Troca {{nome}} pelo valor. Valores que contêm {{outra}} também são resolvidos (até 10 níveis;
 * ciclos param). Variável não encontrada fica como está, igual ao Postman.
 */
export function resolveString(text: string, lookup: Lookup): string {
  if (!text || text.indexOf('{{') < 0) return text
  const walk = (s: string, depth: number, seen: Set<string>): string =>
    s.replace(VAR_RE, (whole, raw: string) => {
      const name = raw.trim()
      const v = lookup.get(name)
      if (v) {
        if (depth >= MAX_DEPTH || seen.has(name)) return v.value
        const next = new Set(seen).add(name)
        return v.value.indexOf('{{') >= 0 ? walk(v.value, depth + 1, next) : v.value
      }
      if (isDynamic(name)) return DYNAMIC[name].gen()
      return whole
    })
  return walk(text, 0, new Set())
}

/** Posições de {{...}} no texto (para destacar na tela). */
export function findVars(text: string): { name: string; start: number; end: number }[] {
  const out: { name: string; start: number; end: number }[] = []
  VAR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = VAR_RE.exec(text))) out.push({ name: m[1].trim(), start: m.index, end: m.index + m[0].length })
  return out
}

const resolveKv = (list: KeyValue[] | undefined, lookup: Lookup) =>
  list?.map((kv) => (kv.disabled ? kv : { ...kv, key: resolveString(kv.key, lookup), value: resolveString(kv.value, lookup) }))

function resolveBody(body: RequestBody | undefined, lookup: Lookup): RequestBody | undefined {
  if (!body) return body
  switch (body.mode) {
    case 'raw':
      return { ...body, raw: resolveString(body.raw ?? '', lookup) }
    case 'urlencoded':
      return { ...body, urlencoded: resolveKv(body.urlencoded, lookup) }
    case 'formdata':
      return {
        ...body,
        formdata: body.formdata?.map((e) =>
          e.disabled
            ? e
            : { ...e, key: resolveString(e.key, lookup), value: e.type === 'text' ? resolveString(e.value ?? '', lookup) : e.value }
        )
      }
    default:
      return body
  }
}

/** Cópia da requisição com todas as {{variáveis}} resolvidas (URL, headers e corpo). */
export function resolveDoc(doc: RequestDoc, lookup: Lookup): RequestDoc {
  return {
    ...doc,
    request: {
      ...doc.request,
      url: { ...doc.request.url, raw: resolvePathVars(resolveString(doc.request.url.raw, lookup), doc.request.url.variable, lookup) },
      header: resolveKv(doc.request.header, lookup) ?? [],
      body: resolveBody(doc.request.body, lookup)
    }
  }
}

/** Variáveis citadas que não existem em nenhum escopo (e não são dinâmicas). */
export function unresolvedIn(text: string, lookup: Lookup): string[] {
  return findVars(text)
    .map((v) => v.name)
    .filter((n) => !lookup.has(n) && !isDynamic(n))
}

/** Nomes das path variables (`/users/:id/posts/:postId`) na parte de caminho da URL. */
export function pathVarNames(raw: string): string[] {
  const noQuery = raw.split(/[?#]/)[0]
  const afterHost = noQuery.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '')
  const out: string[] = []
  for (const seg of afterHost.split('/')) {
    const m = /^:([A-Za-z0-9_.$-]+)$/.exec(seg)
    if (m && !out.includes(m[1])) out.push(m[1])
  }
  return out
}

/** Troca segmentos `:nome` pelo valor da path variable (o valor também aceita {{variáveis}}). */
export function resolvePathVars(raw: string, vars: KeyValue[] | undefined, lookup: Lookup): string {
  if (!vars?.length) return raw
  const q = raw.search(/[?#]/)
  const head = q < 0 ? raw : raw.slice(0, q)
  const tail = q < 0 ? '' : raw.slice(q)
  const proto = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(head)?.[0] ?? ''
  const path = head
    .slice(proto.length)
    .split('/')
    .map((seg) => {
      const m = /^:([A-Za-z0-9_.$-]+)$/.exec(seg)
      if (!m) return seg
      const v = vars.find((x) => x.key === m[1] && !x.disabled)
      return v && v.value !== '' ? resolveString(v.value, lookup) : seg
    })
    .join('/')
  return proto + path + tail
}
