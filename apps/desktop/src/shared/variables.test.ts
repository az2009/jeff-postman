import { describe, expect, it } from 'vitest'
import { findVars, makeLookup, resolveDoc, resolveString, unresolvedIn, type Scope } from './variables'
import type { RequestDoc } from './types'

const kv = (key: string, value: string, extra: object = {}) => ({ key, value, ...extra })

describe('precedência (igual ao Postman: global < collection < environment < data < local)', () => {
  const scopes: Scope[] = [
    { name: 'local', values: [kv('a', 'local')] },
    { name: 'global', values: [kv('a', 'global'), kv('b', 'global'), kv('c', 'global'), kv('d', 'global'), kv('e', 'global')] },
    { name: 'environment', values: [kv('a', 'env'), kv('b', 'env'), kv('c', 'env')] },
    { name: 'collection', values: [kv('a', 'col'), kv('b', 'col'), kv('c', 'col'), kv('d', 'col')] },
    { name: 'data', values: [kv('a', 'data'), kv('b', 'data')] }
  ]
  const l = makeLookup(scopes)
  it('o escopo mais forte vence', () => {
    expect(l.get('a')).toMatchObject({ value: 'local', scope: 'local' })
    expect(l.get('b')).toMatchObject({ value: 'data', scope: 'data' })
    expect(l.get('c')).toMatchObject({ value: 'env', scope: 'environment' })
    expect(l.get('d')).toMatchObject({ value: 'col', scope: 'collection' })
    expect(l.get('e')).toMatchObject({ value: 'global', scope: 'global' })
  })
  it('a ordem em que os escopos chegam não importa', () => {
    const r = makeLookup([...scopes].reverse())
    expect([...r.entries()]).toEqual([...l.entries()])
  })
})

describe('resolveString', () => {
  it('variável desligada não vale e deixa o escopo de baixo aparecer', () => {
    const l = makeLookup([
      { name: 'global', values: [kv('host', 'g.com')] },
      { name: 'environment', values: [kv('host', 'e.com', { disabled: true })] }
    ])
    expect(resolveString('https://{{host}}/x', l)).toBe('https://g.com/x')
  })
  it('não definida fica como está', () => {
    expect(resolveString('{{nada}}/{{ nada }}', makeLookup([]))).toBe('{{nada}}/{{ nada }}')
  })
  it('aceita espaço dentro das chaves', () => {
    const l = makeLookup([{ name: 'global', values: [kv('id', '7')] }])
    expect(resolveString('/u/{{ id }}', l)).toBe('/u/7')
  })
  it('resolve valor que referencia outra variável', () => {
    const l = makeLookup([
      { name: 'environment', values: [kv('base', 'https://{{host}}:{{port}}'), kv('host', 'api.local'), kv('port', '8080')] }
    ])
    expect(resolveString('{{base}}/v1', l)).toBe('https://api.local:8080/v1')
  })
  it('ciclo não trava', () => {
    const l = makeLookup([{ name: 'global', values: [kv('a', '{{b}}'), kv('b', '{{a}}')] }])
    expect(() => resolveString('{{a}}', l)).not.toThrow()
  })
  it('dinâmicas', () => {
    const l = makeLookup([])
    expect(resolveString('{{$guid}}', l)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(Number(resolveString('{{$timestamp}}', l))).toBeGreaterThan(1_700_000_000)
    expect(resolveString('{{$isoTimestamp}}', l)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(resolveString('{{$randomEmail}}', l)).toMatch(/@example\.com$/)
  })
  it('variável definida pelo usuário vence a dinâmica de mesmo nome', () => {
    const l = makeLookup([{ name: 'global', values: [kv('$guid', 'fixo')] }])
    expect(resolveString('{{$guid}}', l)).toBe('fixo')
  })
})

describe('resolveDoc', () => {
  const l = makeLookup([
    { name: 'environment', values: [kv('host', 'api.local'), kv('token', 'abc'), kv('nome', 'Ana')] }
  ])
  const doc = (body: RequestDoc['request']['body']): RequestDoc => ({
    name: 'r',
    request: {
      method: 'POST',
      url: { raw: 'https://{{host}}/u?t={{token}}' },
      header: [kv('Authorization', 'Bearer {{token}}'), kv('X-Off', '{{token}}', { disabled: true })],
      body
    }
  })
  it('URL e headers (desligado não é tocado)', () => {
    const r = resolveDoc(doc({ mode: 'none' }), l)
    expect(r.request.url.raw).toBe('https://api.local/u?t=abc')
    expect(r.request.header[0].value).toBe('Bearer abc')
    expect(r.request.header[1].value).toBe('{{token}}')
  })
  it('corpo raw, urlencoded e form-data', () => {
    expect(resolveDoc(doc({ mode: 'raw', raw: '{"n":"{{nome}}"}' }), l).request.body?.raw).toBe('{"n":"Ana"}')
    expect(resolveDoc(doc({ mode: 'urlencoded', urlencoded: [kv('{{nome}}', '{{token}}')] }), l).request.body?.urlencoded?.[0]).toMatchObject({
      key: 'Ana',
      value: 'abc'
    })
    const fd = resolveDoc(
      doc({ mode: 'formdata', formdata: [{ key: 'n', type: 'text', value: '{{nome}}' }, { key: 'f', type: 'file', src: ['C:/{{nome}}.txt'] }] }),
      l
    ).request.body?.formdata
    expect(fd?.[0].value).toBe('Ana')
    expect(fd?.[1].src).toEqual(['C:/{{nome}}.txt'])
  })
  it('não altera o documento original', () => {
    const d = doc({ mode: 'raw', raw: '{{nome}}' })
    resolveDoc(d, l)
    expect(d.request.url.raw).toBe('https://{{host}}/u?t={{token}}')
  })
})

describe('auxiliares', () => {
  it('findVars e unresolvedIn', () => {
    expect(findVars('a{{x}}b{{ y }}')).toEqual([
      { name: 'x', start: 1, end: 6 },
      { name: 'y', start: 7, end: 14 }
    ])
    const l = makeLookup([{ name: 'global', values: [kv('x', '1')] }])
    expect(unresolvedIn('{{x}}{{y}}{{$guid}}', l)).toEqual(['y'])
  })
})
