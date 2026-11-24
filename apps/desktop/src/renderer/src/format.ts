/**
 * Reindenta JSON sem passar por JSON.parse: preserva números grandes, ordem e escapes exatamente
 * como vieram. Se o texto não parecer JSON, devolve sem mudar.
 */
export function prettyJson(text: string, indent = '  '): string {
  const src = text.trim()
  if (!src || (src[0] !== '{' && src[0] !== '[')) return text
  let out = ''
  let depth = 0
  let inString = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inString) {
      out += c
      if (c === '\\') out += src[++i] ?? ''
      else if (c === '"') inString = false
      continue
    }
    switch (c) {
      case '"':
        inString = true
        out += c
        break
      case '{':
      case '[': {
        // vazio fica junto: {} e []
        let j = i + 1
        while (j < src.length && /\s/.test(src[j])) j++
        if (src[j] === (c === '{' ? '}' : ']')) {
          out += c + src[j]
          i = j
        } else {
          depth++
          out += c + '\n' + indent.repeat(depth)
        }
        break
      }
      case '}':
      case ']':
        depth = Math.max(0, depth - 1)
        out += '\n' + indent.repeat(depth) + c
        break
      case ',':
        out += ',\n' + indent.repeat(depth)
        break
      case ':':
        out += ': '
        break
      default:
        if (!/\s/.test(c)) out += c
    }
  }
  return out
}

export type BodyLanguage = 'json' | 'xml' | 'html' | 'javascript' | 'css' | 'plaintext'

export function languageFromContentType(ct: string | undefined, text: string): BodyLanguage {
  const t = (ct ?? '').toLowerCase()
  if (t.includes('json')) return 'json'
  if (t.includes('html')) return 'html'
  if (t.includes('xml')) return 'xml'
  if (t.includes('javascript') || t.includes('ecmascript')) return 'javascript'
  if (t.includes('css')) return 'css'
  const s = text.trimStart()
  if (s.startsWith('{') || s.startsWith('[')) return 'json'
  if (s.startsWith('<')) return /^<(!doctype html|html)/i.test(s) ? 'html' : 'xml'
  return 'plaintext'
}

export function charsetOf(ct: string | undefined): string {
  const m = /charset=([^;]+)/i.exec(ct ?? '')
  return m ? m[1].trim().replace(/"/g, '') : 'utf-8'
}

export function decodeText(bytes: Uint8Array, ct: string | undefined): string {
  try {
    return new TextDecoder(charsetOf(ct)).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}
