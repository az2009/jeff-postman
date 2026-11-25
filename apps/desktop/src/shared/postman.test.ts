import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import {
  SCHEMA_V20,
  SCHEMA_V21,
  exportCollection,
  exportEnvironment,
  parsePostman,
  urlParts,
  type ExportNode,
  type ImportedCollection,
  type ImportedNode
} from './postman'
import { canon, sample } from './postman.fixtures'

/** Simula o banco: nós importados viram nós de exportação (com ids). */
function toExport(nodes: ImportedNode[]): ExportNode[] {
  let n = 0
  return nodes.map((x) =>
    x.kind === 'folder'
      ? { id: `f${n++}`, kind: 'folder', name: x.name, doc: x.folder, children: toExport(x.children) }
      : { id: `r${n++}`, kind: 'request', name: x.name, doc: x.doc, children: [] }
  )
}

function roundTrip(json: unknown, v: '2.1' | '2.0' = '2.1') {
  const p = parsePostman(json)
  if (p.kind !== 'collection') throw new Error('não é collection')
  const c: ImportedCollection = p.data
  return exportCollection(
    { id: 'id-1', name: c.name, description: c.description, auth: c.auth, event: c.event, variables: c.variables, infoExtra: c.infoExtra, items: toExport(c.items) },
    v
  )
}

describe('collection v2.1', () => {
  it('ida e volta sem perder nada', () => {
    expect(canon(roundTrip(sample))).toEqual(canon(sample))
  })
  it('exporta com schema v2.1 e preserva extras do info', () => {
    const out: any = roundTrip(sample)
    expect(out.info.schema).toBe(SCHEMA_V21)
    expect(out.info._exporter_id).toBe('123')
    expect(out.info.description).toBe('Desc da collection')
    const req = out.item[0].item[0].item[0].request
    expect(req.url.path).toEqual(['users', ':id'])
    expect(req.url.query).toEqual([{ key: 'ativo', value: 'true' }, { key: 'page', value: null }, { key: 'desligado', value: '9', disabled: true }])
    expect(req.url.variable).toEqual([{ key: 'id', value: '42', description: 'o id' }])
    expect(req.header[0]).toEqual({ key: 'Accept', value: 'application/json', type: 'text' })
  })
  it('importa headers em texto, request como string e exec em texto', () => {
    const p = parsePostman(sample)
    if (p.kind !== 'collection') throw new Error()
    const form = p.data.items[2]
    expect(form.kind === 'request' && form.doc.request.header).toEqual([
      { key: 'Content-Type', value: 'multipart/form-data' },
      { key: 'X-Desligado', value: '1', disabled: true }
    ])
    const simples = p.data.items[6]
    expect(simples.kind === 'request' && simples.doc.request).toMatchObject({ method: 'GET', url: { raw: 'https://example.com/simples' } })
    const sub = (p.data.items[0] as any).children[0].children[0]
    expect(sub.doc.event[0].script.exec).toEqual(['pm.test("ok", () => {})', 'console.log(2)'])
    expect(sub.doc.request.method).toBe('GET')
  })
})

describe('collection v2.0', () => {
  const v20 = JSON.parse(JSON.stringify(sample))
  v20.info.schema = SCHEMA_V20
  v20.auth = { type: 'bearer', bearer: { token: '{{token}}' } }
  v20.item[1].request.auth = { type: 'basic', basic: { username: 'u', password: 'p' } }
  it('importa auth no formato v2.0 e exporta em v2.1 e v2.0', () => {
    const p = parsePostman(v20)
    expect(p.kind === 'collection' && p.version).toBe('2.0')
    const as21: any = roundTrip(v20, '2.1')
    expect(as21.auth).toEqual({ type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] })
    const as20: any = roundTrip(v20, '2.0')
    expect(as20.info.schema).toBe(SCHEMA_V20)
    expect(as20.auth).toEqual({ type: 'bearer', bearer: { token: '{{token}}' } })
    expect(as20.item[1].request.auth).toEqual({ type: 'basic', basic: { username: 'u', password: 'p' } })
    expect(canon(as21)).toEqual(canon(sample))
  })
})

describe('environment e globals', () => {
  const env = {
    id: 'e1',
    name: 'Prod',
    values: [
      { key: 'host', value: 'api', type: 'default', enabled: true },
      { key: 'token', value: 's', type: 'secret', enabled: true },
      { key: 'n', value: 5, type: 'any', enabled: false },
      { key: 'semtipo', value: 'x' }
    ],
    _postman_variable_scope: 'environment'
  }
  it('importa e exporta', () => {
    const p = parsePostman(env)
    expect(p.kind).toBe('environment')
    expect((p.data as any).values).toEqual([
      { key: 'host', value: 'api' },
      { key: 'token', value: 's', type: 'secret' },
      { key: 'n', value: '5', disabled: true },
      { key: 'semtipo', value: 'x' }
    ])
    const out: any = exportEnvironment({ id: 'e1', name: (p.data as any).name, values: (p.data as any).values }, 'environment', '0.1.0')
    expect(out._postman_variable_scope).toBe('environment')
    expect(out.values[1]).toEqual({ key: 'token', value: 's', type: 'secret', enabled: true })
    expect(out.values[2].enabled).toBe(false)
  })
  it('reconhece globals', () => {
    expect(parsePostman({ values: [], _postman_variable_scope: 'globals' }).kind).toBe('globals')
  })
  it('recusa formato desconhecido e v1', () => {
    expect(() => parsePostman({ a: 1 })).toThrow(/não reconhecido/)
    expect(() => parsePostman({ requests: [], order: [] })).toThrow(/v1/)
  })
})

describe('urlParts', () => {
  it('separa protocolo, host, porta, caminho e query', () => {
    expect(urlParts('https://api.ex.com:8443/a/b?x=1&y#top')).toEqual({
      raw: 'https://api.ex.com:8443/a/b?x=1&y#top',
      hash: 'top',
      protocol: 'https',
      port: '8443',
      host: ['api', 'ex', 'com'],
      path: ['a', 'b'],
      query: [{ key: 'x', value: '1' }, { key: 'y', value: null }]
    })
    expect(urlParts('{{base.url}}/v1').host).toEqual(['{{base.url}}'])
  })
})

// Arquivos reais do operador (não versionados): PM_FILES="a.json;b.json" npm test
const real = (process.env.PM_FILES ?? '').split(';').filter(Boolean)
describe.skipIf(real.length === 0)('arquivos reais (ida e volta)', () => {
  for (const f of real) {
    it(f.split(/[\\/]/).pop()!, () => {
      const json = JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))
      if (json.info) {
        const out = roundTrip(json)
        expect(canon(out)).toEqual(canon(json))
        // e de novo: exportar o exportado dá o mesmo resultado
        expect(canon(roundTrip(out))).toEqual(canon(out))
      } else {
        const p = parsePostman(json)
        const out: any = exportEnvironment({ id: 'x', name: (p.data as any).name, values: (p.data as any).values }, p.kind === 'globals' ? 'globals' : 'environment', '0')
        expect(out.values.map((v: any) => [v.key, String(v.value), v.enabled])).toEqual(
          json.values.filter((v: any) => v.key).map((v: any) => [v.key, v.value === null || v.value === undefined ? '' : String(v.value), v.enabled !== false])
        )
      }
    })
  }
})

describe('formato da API do Postman', () => {
  it('aceita { collection: ... } e { environment: ... }', () => {
    const c = parsePostman({ collection: { info: { name: 'Da API', schema: SCHEMA_V21 }, item: [{ name: 'r', request: { method: 'GET', url: 'https://x' } }] } })
    expect(c.kind).toBe('collection')
    if (c.kind === 'collection') expect(c.data.items).toHaveLength(1)
    const e = parsePostman({ environment: { name: 'Prod', values: [{ key: 'a', value: '1', enabled: true }] } })
    expect(e).toMatchObject({ kind: 'environment', data: { name: 'Prod', values: [{ key: 'a', value: '1' }] } })
  })
})
