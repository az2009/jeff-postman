import { describe, expect, it } from 'vitest'
import { looksLikeCurl, parseCurl, tokenize } from './curl'

describe('tokenize', () => {
  it('aspas, escape e continuação de linha (bash, cmd, PowerShell)', () => {
    expect(tokenize(`curl 'a b' "c \\"d\\"" e\\ f`)).toEqual(['curl', 'a b', 'c "d"', 'e f'])
    expect(tokenize('curl x \\\n  -H "A: 1"')).toEqual(['curl', 'x', '-H', 'A: 1'])
    expect(tokenize('curl x ^\r\n  -H "A: 1"')).toEqual(['curl', 'x', '-H', 'A: 1'])
    expect(tokenize('curl x `\n  -H "A: 1"')).toEqual(['curl', 'x', '-H', 'A: 1'])
    expect(tokenize("curl $'linha\\nnova'")).toEqual(['curl', 'linha\nnova'])
  })
})

describe('parseCurl', () => {
  it('GET simples', () => {
    const d = parseCurl('curl https://api.ex.com/users?page=2')
    expect(d.request).toMatchObject({ method: 'GET', url: { raw: 'https://api.ex.com/users?page=2' }, body: { mode: 'none' } })
  })
  it('POST JSON com headers (copiado do Chrome, estilo bash)', () => {
    const d = parseCurl(`curl 'https://api.ex.com/pedidos' \\
  -H 'accept: application/json' \\
  -H 'content-type: application/json' \\
  --data-raw '{"item":1,"qtd":2}' \\
  --compressed`)
    expect(d.request.method).toBe('POST')
    expect(d.request.header).toEqual([
      { key: 'accept', value: 'application/json' },
      { key: 'content-type', value: 'application/json' }
    ])
    expect(d.request.body).toEqual({ mode: 'raw', raw: '{"item":1,"qtd":2}', options: { raw: { language: 'json' } } })
  })
  it('estilo cmd do Windows (^ e aspas duplas)', () => {
    const d = parseCurl('curl "https://api.ex.com/x" ^\r\n  -X PUT ^\r\n  -H "Authorization: Bearer abc" ^\r\n  -d "a=1&b=dois"')
    expect(d.request.method).toBe('PUT')
    expect(d.request.header).toEqual([{ key: 'Authorization', value: 'Bearer abc' }])
    expect(d.request.body).toEqual({ mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1' }, { key: 'b', value: 'dois' }] })
  })
  it('form-data com arquivo, basic auth e -XDELETE colado', () => {
    const d = parseCurl('curl -XDELETE -u ana:segredo -F nome=Ana -F "foto=@C:/fotos/a.png;type=image/png" https://x.local/up')
    expect(d.request.method).toBe('DELETE')
    expect(d.request.header).toEqual([{ key: 'Authorization', value: 'Basic YW5hOnNlZ3JlZG8=' }])
    expect(d.request.body).toEqual({
      mode: 'formdata',
      formdata: [
        { key: 'nome', type: 'text', value: 'Ana' },
        { key: 'foto', type: 'file', src: ['C:/fotos/a.png'], contentType: 'image/png' }
      ]
    })
  })
  it('-G manda os dados na query e --url=', () => {
    const d = parseCurl('curl -G --url=https://x.local/busca -d q=teste --data-urlencode "nome=João Silva"')
    expect(d.request.method).toBe('GET')
    expect(d.request.url.raw).toBe('https://x.local/busca?q=teste&nome=Jo%C3%A3o%20Silva')
  })
  it('--json, -I e opções ignoradas', () => {
    expect(parseCurl(`curl -s -k -L -o out.txt --json '{"a":1}' x.local`).request).toMatchObject({
      method: 'POST',
      header: [
        { key: 'Content-Type', value: 'application/json' },
        { key: 'Accept', value: 'application/json' }
      ]
    })
    expect(parseCurl('curl -I https://x.local').request.method).toBe('HEAD')
  })
  it('erros', () => {
    expect(() => parseCurl('wget x')).toThrow(/curl/)
    expect(() => parseCurl('curl -X POST')).toThrow(/URL/)
    expect(looksLikeCurl('  curl https://a')).toBe(true)
    expect(looksLikeCurl('https://a')).toBe(false)
  })
})
