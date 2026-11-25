import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import http from 'node:http'
import zlib from 'node:zlib'
import type { AddressInfo } from 'node:net'
import { decode, send } from './http'
import { DEFAULT_SETTINGS, type SendInput } from '@shared/types'

const MB = 1024 * 1024
const bomb = zlib.gzipSync(Buffer.alloc(5 * MB)) // ~5 KB compactado, 5 MB aberto

describe('decode: limite também no corpo descompactado (zip bomb)', () => {
  it('gzip, br e deflate dentro do limite abrem normalmente', () => {
    const txt = Buffer.from('olá '.repeat(1000))
    expect(decode(zlib.gzipSync(txt), 'gzip', MB).equals(txt)).toBe(true)
    expect(decode(zlib.brotliCompressSync(txt), 'br', MB).equals(txt)).toBe(true)
    expect(decode(zlib.deflateSync(txt), 'deflate', MB).equals(txt)).toBe(true)
    expect(decode(zlib.deflateRawSync(txt), 'deflate', MB).equals(txt)).toBe(true)
  })
  it('acima do limite vira erro ETOOBIG em vez de encher a memória', () => {
    expect(bomb.length).toBeLessThan(64 * 1024)
    for (const [body, enc] of [
      [bomb, 'gzip'],
      [zlib.brotliCompressSync(Buffer.alloc(5 * MB)), 'br'],
      [zlib.deflateSync(Buffer.alloc(5 * MB)), 'deflate']
    ] as const) {
      expect(() => decode(body, enc, MB)).toThrow(/descompactada maior que 1 MB/)
    }
  })
  it('corpo inválido para o encoding volta como veio', () => {
    const b = Buffer.from('não é gzip')
    expect(decode(b, 'gzip', MB)).toBe(b)
  })
})

describe('send', () => {
  let server: http.Server
  let base: string
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/bomb') {
        res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Type': 'application/octet-stream' })
        res.end(bomb)
      } else if (req.url === '/hang') {
        // nunca responde
      } else res.end('ok')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => {
    server.closeAllConnections()
    server.close()
  })
  const input = (url: string): SendInput => ({
    requestId: crypto.randomUUID(),
    doc: { name: 't', request: { method: 'GET', url: { raw: url }, header: [], body: { mode: 'none' } } },
    environmentId: null,
    collectionId: null,
    itemId: null
  })

  it('zip bomb pequena no fio é recusada pelo limite de Settings', async () => {
    const r = await send(input(`${base}/bomb`), 'test', { settings: { ...DEFAULT_SETTINGS, maxResponseMb: 1 } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/descompactada maior que 1 MB/)
  })
  it('timeout das Settings derruba requisição pendurada', async () => {
    const r = await send(input(`${base}/hang`), 'test', { settings: { ...DEFAULT_SETTINGS, requestTimeoutMs: 150 } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('ETIMEDOUT')
  })
})
