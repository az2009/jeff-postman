import { describe, expect, it } from 'vitest'
import { limitLogs } from './runner'

const line = (text: string) => ({ level: 'log' as const, text, source: 'Req', event: 'test' as const })

describe('limitLogs (Console do Runner)', () => {
  it('mantém tudo quando cabe', () => {
    const r = limitLogs([line('a'), line('b')])
    expect(r).toEqual({ logs: [line('a'), line('b')], truncated: false })
  })
  it('corta em 200 linhas', () => {
    const r = limitLogs(Array.from({ length: 250 }, (_, i) => line(String(i))))
    expect(r.logs).toHaveLength(200)
    expect(r.truncated).toBe(true)
  })
  it('corta em 32 KB de texto, marcando a linha cortada', () => {
    const big = 'x'.repeat(20 * 1024)
    const r = limitLogs([line(big), line(big), line('depois')])
    expect(r.truncated).toBe(true)
    expect(r.logs).toHaveLength(2)
    expect(r.logs[1].text.endsWith('… (cortado)')).toBe(true)
    expect(r.logs.reduce((a, l) => a + l.text.length, 0)).toBeLessThanOrEqual(32 * 1024 + 20)
  })
})
