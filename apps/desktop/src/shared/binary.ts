/**
 * Detecta o tipo do corpo de uma resposta: PDF, imagem, outro binário ou texto.
 * Olha o Content-Type e, quando ele falta ou é genérico (octet-stream), os primeiros bytes.
 */
export type BodyKind = 'pdf' | 'image' | 'binary' | 'text'

export interface BodyInfo {
  kind: BodyKind
  /** tipo efetivo (o do header ou o deduzido dos bytes) */
  mime: string
  /** extensão sugerida para salvar o arquivo */
  ext: string
}

const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/svg+xml': 'svg',
  'image/avif': 'avif'
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x)

/** Tipo pelos bytes iniciais (assinatura do arquivo); null quando não reconhece. */
export function sniffMime(b: Uint8Array): string | null {
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf' // %PDF-
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return 'image/gif' // GIF8
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp' // RIFF....WEBP
  if (startsWith(b, [0x42, 0x4d]) && b.length > 26 && b[14] >= 12 && b[15] === 0) return 'image/bmp' // BM + cabeçalho DIB
  if (startsWith(b, [0x00, 0x00, 0x01, 0x00]) && b.length > 6 && b[4] > 0) return 'image/x-icon'
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip'
  if (startsWith(b, [0x1f, 0x8b])) return 'application/gzip'
  // SVG: texto que começa (depois de <?xml e comentários) com <svg
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 512)).replace(/^﻿/, '').trimStart()
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml'
  return null
}

/** Conteúdo que não é texto: tem byte nulo ou não é UTF-8 válido nos primeiros 8 KB. */
export function looksBinary(b: Uint8Array): boolean {
  const s = b.subarray(0, 8192)
  if (s.includes(0)) return true
  try {
    // um caractere cortado no fim da amostra não conta como inválido
    new TextDecoder('utf-8', { fatal: true }).decode(s.length === b.length ? s : s.subarray(0, Math.max(0, s.length - 4)))
    return false
  } catch {
    return true
  }
}

export function bodyInfo(bytes: Uint8Array, contentType: string | undefined | null): BodyInfo {
  const ct = (contentType ?? '').split(';')[0].trim().toLowerCase()
  const sniffed = sniffMime(bytes)
  const textual = /^text\/|json|xml|javascript|ecmascript|html|css|csv|yaml|x-www-form-urlencoded|graphql/.test(ct)
  const binary = looksBinary(bytes)

  // PDF: pelo header (desde que o corpo não seja texto, como um JSON de erro) ou pelos bytes
  if ((ct === 'application/pdf' && (sniffed === 'application/pdf' || binary)) || (sniffed === 'application/pdf' && !textual))
    return { kind: 'pdf', mime: 'application/pdf', ext: 'pdf' }
  // imagem: header image/* ou assinatura de imagem; se os dois discordam, valem os bytes
  if ((ct.startsWith('image/') && (binary || ct === 'image/svg+xml' || sniffed?.startsWith('image/'))) || (sniffed?.startsWith('image/') && !textual)) {
    const m = sniffed?.startsWith('image/') ? sniffed : ct
    return { kind: 'image', mime: m, ext: IMAGE_EXT[m] ?? (m.slice(6).replace(/[^a-z0-9]/g, '') || 'img') }
  }
  const mime = !ct || ct.includes('octet-stream') ? (sniffed ?? (ct || (binary ? 'application/octet-stream' : 'text/plain'))) : ct
  if (binary && !textual) return { kind: 'binary', mime, ext: extOf(mime) }
  return { kind: 'text', mime, ext: extOf(mime) }
}

function extOf(mime: string): string {
  if (mime.includes('json')) return 'json'
  if (mime.includes('html')) return 'html'
  if (mime.includes('xml')) return 'xml'
  if (mime.includes('csv')) return 'csv'
  if (mime === 'application/zip') return 'zip'
  if (mime === 'application/gzip') return 'gz'
  if (mime.startsWith('text/')) return 'txt'
  return 'bin'
}

/** Nome do arquivo no Content-Disposition (filename* com UTF-8 tem preferência). */
export function dispositionFilename(value: string | undefined | null): string | null {
  if (!value) return null
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/i.exec(value)
  if (star) {
    try {
      return sanitizeName(decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')))
    } catch {
      /* cai para o filename simples */
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(value)
  if (!plain) return null
  return sanitizeName((plain[2] ?? plain[1]).trim())
}

/** Só o nome, sem pasta e sem caracteres proibidos no Windows. */
export function sanitizeName(name: string): string | null {
  const base = name.split(/[\\/]/).pop()!.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim().replace(/^\.+/, '')
  return base ? base.slice(0, 180) : null
}
