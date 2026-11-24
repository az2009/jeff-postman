/* eslint-disable @typescript-eslint/no-explicit-any */
import { SCHEMA_V21 } from './postman'

/**
 * Forma canônica para comparar semântica: ignora o que o Postman reescreve sozinho
 * (ids, partes da URL derivadas do raw, type:'text' em header, response vazio).
 */
export function canon(j: any): any {
  const kv = (l: any) =>
    (Array.isArray(l) ? l : []).map((x: any) => ({ key: x.key ?? '', value: x.value ?? '', ...(x.disabled ? { disabled: true } : {}) }))
  const auth = (a: any) => {
    if (!a) return undefined
    const o: any = { type: a.type }
    for (const [k, v] of Object.entries(a))
      if (k !== 'type') o[k] = Array.isArray(v) ? Object.fromEntries((v as any[]).map((p) => [p.key, p.value])) : v
    return o
  }
  const ev = (e: any) =>
    e?.length ? e.map((x: any) => ({ listen: x.listen, exec: (Array.isArray(x.script?.exec) ? x.script.exec : String(x.script?.exec ?? '').split(/\r?\n/)) })) : undefined
  const url = (u: any) => {
    if (u === undefined || u === null) return undefined
    if (typeof u === 'string') return { raw: u, off: [], vars: [] }
    return {
      raw: u.raw ?? '',
      off: (u.query ?? []).filter((q: any) => q.disabled).map((q: any) => [q.key, q.value ?? null]),
      vars: (u.variable ?? []).map((v: any) => [v.key, v.value ?? ''])
    }
  }
  const body = (b: any) => {
    if (!b || b.mode === 'none') return undefined
    if (b.mode === 'raw') return { mode: 'raw', raw: b.raw ?? '', lang: b.options?.raw?.language }
    if (b.mode === 'urlencoded') return { mode: b.mode, data: kv(b.urlencoded) }
    if (b.mode === 'formdata')
      return { mode: b.mode, data: (b.formdata ?? []).map((e: any) => [e.key, e.type ?? 'text', e.type === 'file' ? [].concat(e.src ?? []) : (e.value ?? ''), !!e.disabled]) }
    if (b.mode === 'file') return { mode: 'file', src: b.file?.src ?? null }
    return b
  }
  const item = (it: any): any => {
    if (Array.isArray(it.item))
      return { name: it.name, folder: true, auth: auth(it.auth), event: ev(it.event), description: it.description, items: it.item.map(item) }
    const r = typeof it.request === 'string' ? { url: it.request, method: 'GET' } : (it.request ?? {})
    return {
      name: it.name,
      method: (r.method ?? 'GET').toUpperCase(),
      url: url(r.url),
      header: kv(
        typeof r.header === 'string'
          ? r.header
              .split(/\r?\n/)
              .filter((l: string) => l.trim())
              .map((l: string) => {
                const off = l.startsWith('//')
                const line = off ? l.slice(2) : l
                const i = line.indexOf(':')
                return { key: line.slice(0, i).trim(), value: line.slice(i + 1).trim(), ...(off ? { disabled: true } : {}) }
              })
          : r.header
      ),
      body: body(r.body),
      auth: auth(r.auth),
      description: r.description,
      event: ev(it.event),
      response: it.response?.length ? it.response : undefined,
      ppb: it.protocolProfileBehavior
    }
  }
  return {
    name: j.info?.name,
    auth: auth(j.auth),
    event: ev(j.event),
    variable: kv(j.variable),
    items: (j.item ?? []).map(item)
  }
}

export const sample = {
  info: { _postman_id: 'x', name: 'Amostra', description: 'Desc da collection', schema: SCHEMA_V21, _exporter_id: '123' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: ['console.log(1)'] } }],
  variable: [{ key: 'base', value: 'https://api.local', type: 'string' }, { key: 'off', value: '1', disabled: true }],
  item: [
    {
      name: 'Pasta 1',
      description: 'pasta',
      auth: { type: 'noauth' },
      item: [
        {
          name: 'Sub',
          item: [
            {
              name: 'Usuário por id',
              event: [{ listen: 'test', script: { exec: 'pm.test("ok", () => {})\nconsole.log(2)' } }],
              request: {
                method: 'get',
                header: [{ key: 'Accept', value: 'application/json', type: 'text' }, { key: 'X-Off', value: '1', type: 'text', disabled: true }],
                url: {
                  raw: '{{base}}/users/:id?ativo=true&page',
                  host: ['{{base}}'],
                  path: ['users', ':id'],
                  query: [{ key: 'ativo', value: 'true' }, { key: 'page', value: null }, { key: 'desligado', value: '9', disabled: true }],
                  variable: [{ key: 'id', value: '42', description: 'o id' }]
                },
                description: 'busca'
              },
              response: [{ name: 'exemplo', code: 200, body: '{}' }],
              protocolProfileBehavior: { disableBodyPruning: true }
            }
          ]
        }
      ]
    },
    {
      name: 'Criar',
      request: {
        method: 'POST',
        auth: { type: 'basic', basic: [{ key: 'username', value: 'u', type: 'string' }, { key: 'password', value: 'p', type: 'string' }] },
        header: [],
        body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } },
        url: 'https://api.local/criar'
      }
    },
    {
      name: 'Form',
      request: {
        method: 'POST',
        header: 'Content-Type: multipart/form-data\n//X-Desligado: 1',
        body: {
          mode: 'formdata',
          formdata: [
            { key: 'nome', value: 'Ana', type: 'text' },
            { key: 'arq', type: 'file', src: '/tmp/a.txt' },
            { key: 'off', value: 'x', type: 'text', disabled: true }
          ]
        },
        url: { raw: 'https://api.local/form' }
      }
    },
    { name: 'Urlenc', request: { method: 'PUT', header: [], body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1', type: 'text' }] }, url: { raw: 'x.local/u' } } },
    { name: 'Binário', request: { method: 'POST', header: [], body: { mode: 'file', file: { src: 'C:/a.bin' } }, url: { raw: 'x.local/b' } } },
    { name: 'GraphQL', request: { method: 'POST', header: [], body: { mode: 'graphql', graphql: { query: '{ me { id } }', variables: '' } }, url: { raw: 'x.local/gql' } } },
    { name: 'Só URL', request: 'https://example.com/simples' },
    { name: 'Sem URL', request: { method: 'GET', header: [] } }
  ]
}

