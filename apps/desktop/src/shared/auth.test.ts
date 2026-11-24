import { describe, expect, it } from 'vitest'
import { applySimpleAuth, authHeaderName, effectiveAuth, getParam, newAuth, resolveAuth, setParam } from './auth'
import { makeLookup } from './variables'
import type { PmAuth } from './types'

const basic: PmAuth = { type: 'basic', basic: [{ key: 'username', value: 'ana' }, { key: 'password', value: 'sênha:1' }] }

describe('herança', () => {
  const folder: PmAuth = { type: 'bearer', bearer: [{ key: 'token', value: 'da-pasta' }] }
  const col: PmAuth = { type: 'apikey', apikey: [{ key: 'key', value: 'K' }] }
  it('requisição com auth própria vence', () => {
    expect(effectiveAuth(basic, [{ auth: folder, name: 'P', kind: 'folder' }]).auth).toBe(basic)
  })
  it('sem auth própria usa a pasta mais próxima, depois a collection', () => {
    expect(effectiveAuth(undefined, [{ name: 'Sub', kind: 'folder' }, { auth: folder, name: 'P', kind: 'folder' }, { auth: col, name: 'C', kind: 'collection' }])).toEqual({
      auth: folder,
      from: { kind: 'folder', name: 'P' }
    })
    expect(effectiveAuth(undefined, [{ name: 'P', kind: 'folder' }, { auth: col, name: 'C', kind: 'collection' }]).from).toEqual({ kind: 'collection', name: 'C' })
    expect(effectiveAuth(undefined, []).auth).toBeUndefined()
  })
  it('No Auth explícito não herda', () => {
    expect(effectiveAuth({ type: 'noauth' }, [{ auth: col, name: 'C', kind: 'collection' }]).auth).toEqual({ type: 'noauth' })
  })
})

describe('aplicar', () => {
  it('Basic em base64 com UTF-8', () => {
    expect(applySimpleAuth(basic)?.headers).toEqual([['Authorization', 'Basic ' + Buffer.from('ana:sênha:1').toString('base64')]])
  })
  it('Bearer, API Key em header e em query', () => {
    expect(applySimpleAuth({ type: 'bearer', bearer: [{ key: 'token', value: 'abc' }] })?.headers).toEqual([['Authorization', 'Bearer abc']])
    const k = setParam(setParam(newAuth('apikey')!, 'key', 'X-Api-Key'), 'value', '123')
    expect(applySimpleAuth(k)).toEqual({ headers: [['X-Api-Key', '123']], query: [] })
    expect(applySimpleAuth(setParam(k, 'in', 'query'))).toEqual({ headers: [], query: [['X-Api-Key', '123']] })
  })
  it('OAuth 2.0: prefixo e token na URL', () => {
    const o = setParam(newAuth('oauth2')!, 'accessToken', 'tok')
    expect(applySimpleAuth(o)?.headers).toEqual([['Authorization', 'Bearer tok']])
    expect(applySimpleAuth(setParam(o, 'headerPrefix', 'Token'))?.headers).toEqual([['Authorization', 'Token tok']])
    expect(applySimpleAuth(setParam(o, 'addTokenTo', 'queryParams'))?.query).toEqual([['access_token', 'tok']])
    expect(applySimpleAuth(setParam(o, 'accessToken', ''))?.headers).toEqual([])
  })
  it('variáveis nos parâmetros e nome do header automático', () => {
    const b = { type: 'bearer', bearer: [{ key: 'token', value: '{{tk}}' }] }
    const r = resolveAuth(b, makeLookup([{ name: 'environment', values: [{ key: 'tk', value: 'segredo' }] }]))
    expect(getParam(r, 'token')).toBe('segredo')
    expect(getParam(b, 'token')).toBe('{{tk}}')
    expect(authHeaderName(basic)).toBe('Authorization')
    expect(authHeaderName(setParam(setParam(newAuth('apikey')!, 'key', 'X-K'), 'in', 'query'))).toBeNull()
  })
})
