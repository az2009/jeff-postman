import { describe, expect, it } from 'vitest'
import { bodyInfo, dispositionFilename, looksBinary, sniffMime } from './binary'

const bytes = (...x: number[]) => new Uint8Array(x)
const text = (s: string) => new TextEncoder().encode(s)
const PDF = text('%PDF-1.5\n%âã\n4 0 obj\n<< /Length 10 >>\nstream\n')
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52)
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0)
const GIF = text('GIF89a\u0001\u0000')
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38)

describe('sniffMime', () => {
  it('reconhece PDF e imagens pelos bytes', () => {
    expect(sniffMime(PDF)).toBe('application/pdf')
    expect(sniffMime(PNG)).toBe('image/png')
    expect(sniffMime(JPG)).toBe('image/jpeg')
    expect(sniffMime(GIF)).toBe('image/gif')
    expect(sniffMime(WEBP)).toBe('image/webp')
    expect(sniffMime(text('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml')
    expect(sniffMime(text('{"a":1}'))).toBeNull()
  })
})

describe('looksBinary', () => {
  it('texto UTF-8 não é binário; byte nulo e UTF-8 inválido são', () => {
    expect(looksBinary(text('olá, ação {"x": "ç"}'))).toBe(false)
    expect(looksBinary(bytes(0x41, 0x00, 0x42))).toBe(true)
    expect(looksBinary(bytes(0xff, 0xfe, 0xfd, 0x80, 0x81))).toBe(true)
  })
})

describe('bodyInfo', () => {
  it('PDF pelo header e pelos bytes (octet-stream ou sem header)', () => {
    expect(bodyInfo(PDF, 'application/pdf').kind).toBe('pdf')
    expect(bodyInfo(PDF, 'application/octet-stream').kind).toBe('pdf')
    expect(bodyInfo(PDF, undefined)).toEqual({ kind: 'pdf', mime: 'application/pdf', ext: 'pdf' })
  })
  it('imagem pelo header e pelos bytes; bytes vencem header errado', () => {
    expect(bodyInfo(PNG, 'image/png')).toEqual({ kind: 'image', mime: 'image/png', ext: 'png' })
    expect(bodyInfo(JPG, 'application/octet-stream')).toEqual({ kind: 'image', mime: 'image/jpeg', ext: 'jpg' })
    expect(bodyInfo(JPG, 'image/png').mime).toBe('image/jpeg')
    expect(bodyInfo(text('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml').kind).toBe('image')
  })
  it('JSON de erro com header de PDF continua texto', () => {
    expect(bodyInfo(text('{"erro":"nota não encontrada"}'), 'application/pdf').kind).toBe('text')
  })
  it('JSON e HTML são texto; zip e octet-stream desconhecido são binário', () => {
    expect(bodyInfo(text('{"a":1}'), 'application/json; charset=utf-8')).toEqual({ kind: 'text', mime: 'application/json', ext: 'json' })
    expect(bodyInfo(text('<html></html>'), 'text/html').kind).toBe('text')
    expect(bodyInfo(bytes(0x50, 0x4b, 0x03, 0x04, 0, 0, 0x99), 'application/zip')).toEqual({ kind: 'binary', mime: 'application/zip', ext: 'zip' })
    expect(bodyInfo(bytes(1, 2, 0, 200, 3), 'application/octet-stream').kind).toBe('binary')
    expect(bodyInfo(text('ok'), undefined).kind).toBe('text')
  })
})

describe('dispositionFilename', () => {
  it('lê filename e filename*, sem pasta e sem caractere proibido', () => {
    expect(dispositionFilename('attachment; filename="danfe 123.pdf"')).toBe('danfe 123.pdf')
    expect(dispositionFilename("attachment; filename*=UTF-8''nota%20fiscal%20%C3%A7.pdf; filename=\"x.pdf\"")).toBe('nota fiscal ç.pdf')
    expect(dispositionFilename('inline; filename=..\\..\\evil:x.pdf')).toBe('evil_x.pdf')
    expect(dispositionFilename('inline')).toBeNull()
    expect(dispositionFilename(undefined)).toBeNull()
  })
})
