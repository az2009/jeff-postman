import { describe, expect, it } from 'vitest'
import { CookieJar, parseSetCookie } from './cookies'

const u = (s: string) => new URL(s)
const NOW = Date.parse('2026-11-25T00:00:00Z')

describe('parseSetCookie', () => {
  it('atributos, caminho padrão e Max-Age vencendo Expires', () => {
    const c = parseSetCookie('sid="abc"; Path=/api; Secure; HttpOnly; SameSite=Lax; Expires=Wed, 01 Jan 2030 00:00:00 GMT; Max-Age=60', u('https://x.com/api/v1/login'), NOW)!
    expect(c).toMatchObject({ name: 'sid', value: '"abc"', domain: 'x.com', path: '/api', secure: true, httpOnly: true, hostOnly: true, sameSite: 'Lax', expires: NOW + 60000 })
    expect(parseSetCookie('a=1', u('https://x.com/a/b/c'), NOW)!.path).toBe('/a/b')
  })
  it('Domain do próprio site ou de domínio pai é aceito; de outro site, recusado', () => {
    expect(parseSetCookie('a=1; Domain=.example.com', u('https://api.example.com/'), NOW)).toMatchObject({ domain: 'example.com', hostOnly: false })
    expect(parseSetCookie('a=1; Domain=evil.com', u('https://api.example.com/'), NOW)).toBeNull()
    expect(parseSetCookie('sem-igual', u('https://x.com/'), NOW)).toBeNull()
  })
})

describe('CookieJar', () => {
  it('reenvia por domínio, caminho e Secure', () => {
    const j = new CookieJar()
    j.store(u('https://api.example.com/login'), ['host=1', 'pai=2; Domain=example.com', 'seg=3; Secure', 'adm=4; Path=/admin'], NOW)
    expect(j.header(u('https://api.example.com/x'), NOW)).toBe('host=1; pai=2; seg=3')
    expect(j.header(u('http://api.example.com/x'), NOW)).toBe('host=1; pai=2')
    expect(j.header(u('https://www.example.com/'), NOW)).toBe('pai=2')
    expect(j.header(u('https://api.example.com/admin/users'), NOW)).toBe('adm=4; host=1; pai=2; seg=3')
    expect(j.header(u('https://api.example.com/administrator'), NOW)).toBe('host=1; pai=2; seg=3')
    expect(j.header(u('https://outro.com/'), NOW)).toBeNull()
  })
  it('substitui, apaga com Max-Age=0 e descarta vencidos', () => {
    const j = new CookieJar()
    j.store(u('https://x.com/'), ['a=1', 'b=2; Max-Age=10'], NOW)
    j.store(u('https://x.com/'), ['a=novo'], NOW)
    expect(j.header(u('https://x.com/'), NOW)).toBe('a=novo; b=2')
    expect(j.header(u('https://x.com/'), NOW + 11000)).toBe('a=novo')
    j.store(u('https://x.com/'), ['a=; Max-Age=0'], NOW)
    expect(j.cookies).toHaveLength(0)
    expect(j.dirty).toBe(true)
  })
})

describe('CookieJar.changes (gravar só o que mudou)', () => {
  it('registra criação, troca e remoção por domínio/caminho/nome', () => {
    const j = new CookieJar([{ name: 'velho', value: '1', domain: 'x.com', path: '/', expires: null, secure: false, httpOnly: false, hostOnly: true, createdAt: NOW }])
    j.store(u('https://x.com/'), ['novo=2', 'velho=; Max-Age=0'], NOW)
    expect([...j.changes.entries()].map(([k, c]) => [k, c?.value ?? null])).toEqual([
      ['x.com\t/\tnovo', '2'],
      ['x.com\t/\tvelho', null]
    ])
  })
  it('cookie vencido descartado no envio também entra como remoção', () => {
    const j = new CookieJar([{ name: 'v', value: '1', domain: 'x.com', path: '/', expires: NOW - 1, secure: false, httpOnly: false, hostOnly: true, createdAt: NOW - 10 }])
    expect(j.header(u('https://x.com/'), NOW)).toBeNull()
    expect(j.changes.get('x.com\t/\tv')).toBeNull()
  })
  it('valor entre aspas volta com as aspas (RFC 6265)', () => {
    const j = new CookieJar()
    j.store(u('https://x.com/'), ['sid="a b"'], NOW)
    expect(j.header(u('https://x.com/'), NOW)).toBe('sid="a b"')
  })
})
