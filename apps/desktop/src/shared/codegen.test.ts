import { describe, expect, it } from 'vitest'
import { generate } from './codegen'

const json = {
  method: 'POST',
  url: 'https://api.local/pedidos?x=1',
  headers: [
    ['Content-Type', 'application/json'],
    ['Authorization', "Bearer it's"]
  ] as [string, string][],
  body: { mode: 'raw' as const, raw: '{"item":"d\'agua"}', options: { raw: { language: 'json' as const } } }
}

describe('codegen', () => {
  it('cURL com aspas simples escapadas', () => {
    expect(generate('curl', json)).toBe(
      `curl --location --request POST 'https://api.local/pedidos?x=1' \\\n--header 'Content-Type: application/json' \\\n--header 'Authorization: Bearer it'\\''s' \\\n--data-raw '{"item":"d'\\''agua"}'`
    )
  })
  it('PowerShell põe Content-Type em -ContentType e dobra as aspas', () => {
    const c = generate('powershell', json)
    expect(c).toContain(`'Authorization' = 'Bearer it''s'`)
    expect(c).not.toContain(`'Content-Type' =`)
    expect(c).toContain(`$response = Invoke-RestMethod -Uri 'https://api.local/pedidos?x=1' -Method POST -Headers $headers -Body $body -ContentType 'application/json'`)
  })
  it('fetch e Python', () => {
    const f = generate('fetch', json)
    expect(f).toContain('myHeaders.append("Authorization", "Bearer it\'s");')
    expect(f).toContain('const raw = "{\\"item\\":\\"d\'agua\\"}";')
    expect(f).toContain('fetch("https://api.local/pedidos?x=1", requestOptions)')
    const p = generate('python', json)
    expect(p).toContain('response = requests.request("POST", url, headers=headers, data=payload)')
  })
  it('form-data com arquivo e urlencoded', () => {
    const fd = {
      method: 'POST',
      url: 'https://x.local/up',
      headers: [['Content-Type', 'multipart/form-data']] as [string, string][],
      body: { mode: 'formdata' as const, formdata: [{ key: 'nome', type: 'text' as const, value: 'Ana' }, { key: 'doc', type: 'file' as const, src: ['C:/a/rel.pdf'] }] }
    }
    expect(generate('curl', fd)).toBe(`curl --location --request POST 'https://x.local/up' \\\n--form 'nome="Ana"' \\\n--form 'doc=@"C:/a/rel.pdf"'`)
    expect(generate('python', fd)).toContain('("doc", ("rel.pdf", open("C:/a/rel.pdf", "rb"), "application/pdf")),')
    const ue = { method: 'PUT', url: 'https://x.local', headers: [] as [string, string][], body: { mode: 'urlencoded' as const, urlencoded: [{ key: 'a', value: '1 2' }] } }
    expect(generate('curl', ue)).toContain(`--data-urlencode 'a=1 2'`)
    expect(generate('fetch', ue)).toContain('urlencoded.append("a", "1 2");')
  })
})

describe('form-data no cURL', () => {
  it('aspas e barra no valor vão escapadas dentro das aspas do --form', () => {
    const fd = {
      method: 'POST',
      url: 'https://x.local',
      headers: [] as [string, string][],
      body: { mode: 'formdata' as const, formdata: [{ key: 'msg', type: 'text' as const, value: 'diz "oi" \\ tchau' }] }
    }
    expect(generate('curl', fd)).toContain(`--form 'msg="diz \\"oi\\" \\\\ tchau"'`)
  })
})
