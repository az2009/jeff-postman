import type { FormDataEntry, HttpMethod, KeyValue, RequestDoc } from './types'

/** Parece um comando cURL? */
export const looksLikeCurl = (text: string) => /^\s*curl(\.exe)?\s/i.test(text)

/**
 * Quebra a linha de comando em argumentos, como um shell: aspas simples e duplas, $'...' do bash,
 * e continuação de linha com \ (bash), ^ (cmd) ou ` (PowerShell).
 */
export function tokenize(cmd: string): string[] {
  const s = cmd.replace(/\\\r?\n|\^\r?\n|`\r?\n/g, ' ')
  const out: string[] = []
  let cur = ''
  let has = false
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) {
      if (has) out.push(cur)
      cur = ''
      has = false
      i++
      continue
    }
    has = true
    if (c === "'" ) {
      const j = s.indexOf("'", i + 1)
      cur += s.slice(i + 1, j < 0 ? s.length : j)
      i = j < 0 ? s.length : j + 1
    } else if (c === '$' && s[i + 1] === "'") {
      i += 2
      while (i < s.length && s[i] !== "'") {
        if (s[i] === '\\' && i + 1 < s.length) {
          const n = s[i + 1]
          cur += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n
          i += 2
        } else cur += s[i++]
      }
      i++
    } else if (c === '"') {
      i++
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) {
          cur += s[i + 1]
          i += 2
        } else cur += s[i++]
      }
      i++
    } else if (c === '\\' && i + 1 < s.length) {
      cur += s[i + 1]
      i += 2
    } else {
      cur += c
      i++
    }
  }
  if (has) out.push(cur)
  return out
}

const WITH_VALUE = new Set([
  '-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode',
  '-F', '--form', '--form-string', '-u', '--user', '-A', '--user-agent', '-b', '--cookie', '-e', '--referer', '--url',
  '-o', '--output', '-m', '--max-time', '--connect-timeout', '-x', '--proxy', '--cacert', '--cert', '--key', '-w', '--write-out',
  '--retry', '-c', '--cookie-jar', '-T', '--upload-file', '--json'
])

function b64(s: string): string {
  let bin = ''
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** Converte um comando cURL numa requisição (como o Import > Raw text do Postman). */
export function parseCurl(cmd: string): RequestDoc {
  const args = tokenize(cmd.trim())
  if (!args.length || !/^curl(\.exe)?$/i.test(args[0])) throw new Error('O texto não começa com curl')
  let method: string | null = null
  let url = ''
  let get = false
  let head = false
  const headers: KeyValue[] = []
  const data: { kind: 'raw' | 'urlencode'; value: string }[] = []
  const form: FormDataEntry[] = []
  let json = false

  for (let i = 1; i < args.length; i++) {
    let a = args[i]
    let v: string | undefined
    // --opcao=valor
    if (a.startsWith('--') && a.includes('=')) {
      const eq = a.indexOf('=')
      v = a.slice(eq + 1)
      a = a.slice(0, eq)
    } else if (/^-[A-Za-z]./.test(a) && WITH_VALUE.has(a.slice(0, 2))) {
      // -XPOST, -Hfoo:bar
      v = a.slice(2)
      a = a.slice(0, 2)
    }
    const val = () => (v !== undefined ? v : (args[++i] ?? ''))
    switch (a) {
      case '-X':
      case '--request':
        method = val().toUpperCase()
        break
      case '-H':
      case '--header': {
        const h = val()
        const c = h.indexOf(':')
        if (c > 0) headers.push({ key: h.slice(0, c).trim(), value: h.slice(c + 1).trim() })
        break
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
        data.push({ kind: 'raw', value: val() })
        break
      case '--json':
        data.push({ kind: 'raw', value: val() })
        json = true
        break
      case '--data-urlencode':
        data.push({ kind: 'urlencode', value: val() })
        break
      case '-F':
      case '--form':
      case '--form-string': {
        const f = val()
        const eq = f.indexOf('=')
        const key = eq < 0 ? f : f.slice(0, eq)
        let value = eq < 0 ? '' : f.slice(eq + 1)
        let contentType: string | undefined
        const ct = /;type=([^;]+)/.exec(value)
        if (ct) {
          contentType = ct[1]
          value = value.replace(ct[0], '')
        }
        if (a !== '--form-string' && value.startsWith('@')) form.push({ key, type: 'file', src: [value.slice(1)], ...(contentType ? { contentType } : {}) })
        else form.push({ key, type: 'text', value: value.replace(/^</, ''), ...(contentType ? { contentType } : {}) })
        break
      }
      case '-u':
      case '--user':
        headers.push({ key: 'Authorization', value: `Basic ${b64(val())}` })
        break
      case '-A':
      case '--user-agent':
        headers.push({ key: 'User-Agent', value: val() })
        break
      case '-b':
      case '--cookie':
        headers.push({ key: 'Cookie', value: val() })
        break
      case '-e':
      case '--referer':
        headers.push({ key: 'Referer', value: val() })
        break
      case '--url':
        url = val()
        break
      case '-G':
      case '--get':
        get = true
        break
      case '-I':
      case '--head':
        head = true
        break
      default:
        if (WITH_VALUE.has(a)) val()
        else if (!a.startsWith('-') && !url) url = a
    }
  }
  if (!url) throw new Error('Não achei a URL no comando cURL')
  if (json) {
    if (!headers.some((h) => h.key.toLowerCase() === 'content-type')) headers.push({ key: 'Content-Type', value: 'application/json' })
    if (!headers.some((h) => h.key.toLowerCase() === 'accept')) headers.push({ key: 'Accept', value: 'application/json' })
  }

  const doc: RequestDoc = { name: url, request: { method: 'GET', url: { raw: url }, header: headers, body: { mode: 'none' } } }
  const ctHeader = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? ''

  if (form.length) {
    doc.request.body = { mode: 'formdata', formdata: form }
    // o boundary é gerado no envio
    doc.request.header = headers.filter((h) => !(h.key.toLowerCase() === 'content-type' && h.value.toLowerCase().startsWith('multipart/form-data')))
  } else if (data.length) {
    const joined = data.map((d) => (d.kind === 'urlencode' ? encodeData(d.value) : d.value)).join('&')
    if (get) {
      doc.request.url.raw = url + (url.includes('?') ? '&' : '?') + joined
    } else {
      const isForm = (!ctHeader || ctHeader.includes('x-www-form-urlencoded')) && !looksJson(joined) && /^[^=&]+=[^&]*(&[^=&]+=[^&]*)*$/.test(joined)
      if (isForm) {
        doc.request.body = {
          mode: 'urlencoded',
          urlencoded: joined.split('&').map((p) => {
            const eq = p.indexOf('=')
            return { key: safeDecode(p.slice(0, eq)), value: safeDecode(p.slice(eq + 1)) }
          })
        }
        doc.request.header = headers.filter((h) => h.key.toLowerCase() !== 'content-type')
      } else {
        const language = ctHeader.includes('json') || looksJson(joined) ? 'json' : ctHeader.includes('xml') ? 'xml' : ctHeader.includes('html') ? 'html' : 'text'
        doc.request.body = { mode: 'raw', raw: joined, options: { raw: { language } } }
      }
    }
  }
  const hasBody = doc.request.body?.mode !== 'none'
  doc.request.method = (method ?? (head ? 'HEAD' : hasBody ? 'POST' : 'GET')) as HttpMethod
  return doc
}

function encodeData(v: string): string {
  const eq = v.indexOf('=')
  if (eq < 0) return encodeURIComponent(v)
  return `${v.slice(0, eq)}=${encodeURIComponent(v.slice(eq + 1))}`
}

function looksJson(s: string): boolean {
  const t = s.trim()
  if (!(t.startsWith('{') || t.startsWith('['))) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}
