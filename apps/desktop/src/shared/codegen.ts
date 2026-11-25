/** Gera código a partir de uma requisição já resolvida (variáveis trocadas, auth simples aplicado). */
import type { RequestBody } from './types'
import { fileName, mimeFromPath } from './http'

export interface CodeInput {
  method: string
  url: string
  headers: [string, string][]
  body: RequestBody | undefined
}

export const LANGUAGES = [
  { id: 'curl', label: 'cURL', editor: 'shell' },
  { id: 'powershell', label: 'PowerShell - Invoke-RestMethod', editor: 'powershell' },
  { id: 'fetch', label: 'JavaScript - Fetch', editor: 'javascript' },
  { id: 'python', label: 'Python - Requests', editor: 'python' }
] as const
export type Language = (typeof LANGUAGES)[number]['id']

const active = (b: RequestBody | undefined) => (b && !b.disabled && b.mode !== 'none' ? b : null)
const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const js = (s: string) => JSON.stringify(s)
const py = (s: string) => JSON.stringify(s)
const ps = (s: string) => `'${s.replace(/'/g, "''")}'`
const files = (src: string | string[] | undefined) => (Array.isArray(src) ? src : src ? [src] : [])

export function generate(lang: Language, r: CodeInput): string {
  switch (lang) {
    case 'curl':
      return curl(r)
    case 'powershell':
      return powershell(r)
    case 'fetch':
      return fetchJs(r)
    case 'python':
      return python(r)
  }
}

function curl(r: CodeInput): string {
  const lines = [`curl --location --request ${r.method} ${sq(r.url)}`]
  const b = active(r.body)
  for (const [k, v] of r.headers) {
    if (b?.mode === 'formdata' && k.toLowerCase() === 'content-type') continue
    lines.push(`--header ${sq(`${k}: ${v}`)}`)
  }
  if (b?.mode === 'raw') lines.push(`--data-raw ${sq(b.raw ?? '')}`)
  if (b?.mode === 'urlencoded') for (const p of b.urlencoded ?? []) if (!p.disabled && p.key) lines.push(`--data-urlencode ${sq(`${p.key}=${p.value}`)}`)
  if (b?.mode === 'formdata')
    for (const e of b.formdata ?? []) {
      if (e.disabled || !e.key) continue
      if (e.type === 'file') for (const f of files(e.src)) lines.push(`--form ${sq(`${e.key}=@"${f}"`)}`)
      else lines.push(`--form ${sq(`${e.key}="${e.value ?? ''}"`)}`)
    }
  if (b?.mode === 'file' && b.file?.src) lines.push(`--data-binary ${sq('@' + b.file.src)}`)
  return lines.join(' \\\n')
}

function powershell(r: CodeInput): string {
  const b = active(r.body)
  const out: string[] = []
  const ct = r.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1]
  const hs = r.headers.filter(([k]) => k.toLowerCase() !== 'content-type')
  if (hs.length) {
    out.push('$headers = @{')
    for (const [k, v] of hs) out.push(`    ${ps(k)} = ${ps(v)}`)
    out.push('}')
  }
  const args = [`-Uri ${ps(r.url)}`, `-Method ${r.method}`]
  if (hs.length) args.push('-Headers $headers')
  if (b?.mode === 'raw') {
    out.push(`$body = @'\n${b.raw ?? ''}\n'@`)
    args.push('-Body $body')
    if (ct) args.push(`-ContentType ${ps(ct)}`)
  } else if (b?.mode === 'urlencoded') {
    out.push('$body = @{')
    for (const p of b.urlencoded ?? []) if (!p.disabled && p.key) out.push(`    ${ps(p.key)} = ${ps(p.value)}`)
    out.push('}')
    args.push('-Body $body', `-ContentType 'application/x-www-form-urlencoded'`)
  } else if (b?.mode === 'formdata') {
    out.push('# multipart/form-data: -Form precisa do PowerShell 7 ou mais novo')
    out.push('$form = @{')
    for (const e of b.formdata ?? []) {
      if (e.disabled || !e.key) continue
      if (e.type === 'file') for (const f of files(e.src)) out.push(`    ${ps(e.key)} = Get-Item -Path ${ps(f)}`)
      else out.push(`    ${ps(e.key)} = ${ps(e.value ?? '')}`)
    }
    out.push('}')
    args.push('-Form $form')
  } else if (b?.mode === 'file' && b.file?.src) {
    args.push(`-InFile ${ps(b.file.src)}`)
    if (ct) args.push(`-ContentType ${ps(ct)}`)
  }
  out.push(`$response = Invoke-RestMethod ${args.join(' ')}`)
  out.push('$response | ConvertTo-Json -Depth 10')
  return out.join('\n')
}

function fetchJs(r: CodeInput): string {
  const b = active(r.body)
  const out: string[] = []
  const hs = r.headers.filter(([k]) => !(b?.mode === 'formdata' && k.toLowerCase() === 'content-type'))
  if (hs.length) {
    out.push('const myHeaders = new Headers();')
    for (const [k, v] of hs) out.push(`myHeaders.append(${js(k)}, ${js(v)});`)
    out.push('')
  }
  let bodyVar: string | null = null
  if (b?.mode === 'raw') {
    out.push(`const raw = ${js(b.raw ?? '')};`, '')
    bodyVar = 'raw'
  } else if (b?.mode === 'urlencoded') {
    out.push('const urlencoded = new URLSearchParams();')
    for (const p of b.urlencoded ?? []) if (!p.disabled && p.key) out.push(`urlencoded.append(${js(p.key)}, ${js(p.value)});`)
    out.push('')
    bodyVar = 'urlencoded'
  } else if (b?.mode === 'formdata') {
    out.push('const formdata = new FormData();')
    for (const e of b.formdata ?? []) {
      if (e.disabled || !e.key) continue
      if (e.type === 'file') for (const f of files(e.src)) out.push(`formdata.append(${js(e.key)}, fileInput.files[0], ${js(fileName(f))});`)
      else out.push(`formdata.append(${js(e.key)}, ${js(e.value ?? '')});`)
    }
    out.push('')
    bodyVar = 'formdata'
  } else if (b?.mode === 'file' && b.file?.src) {
    out.push(`const file = "<conteúdo de ${fileName(b.file.src)}>";`, '')
    bodyVar = 'file'
  }
  out.push('const requestOptions = {', `  method: ${js(r.method)},`)
  if (hs.length) out.push('  headers: myHeaders,')
  if (bodyVar) out.push(`  body: ${bodyVar},`)
  out.push('  redirect: "follow"', '};', '')
  out.push(`fetch(${js(r.url)}, requestOptions)`, '  .then((response) => response.text())', '  .then((result) => console.log(result))', '  .catch((error) => console.error(error));')
  return out.join('\n')
}

function python(r: CodeInput): string {
  const b = active(r.body)
  const out = ['import requests', '', `url = ${py(r.url)}`, '']
  let call = `response = requests.request(${py(r.method)}, url`
  if (b?.mode === 'raw') {
    out.push(`payload = ${py(b.raw ?? '')}`)
    call += ', headers=headers, data=payload'
  } else if (b?.mode === 'urlencoded') {
    const qs = (b.urlencoded ?? []).filter((p) => !p.disabled && p.key)
    out.push('payload = {', ...qs.map((p) => `  ${py(p.key)}: ${py(p.value)},`), '}')
    call += ', headers=headers, data=payload'
  } else if (b?.mode === 'formdata') {
    const text = (b.formdata ?? []).filter((e) => !e.disabled && e.key && e.type !== 'file')
    const fl = (b.formdata ?? []).filter((e) => !e.disabled && e.key && e.type === 'file')
    out.push('payload = {', ...text.map((e) => `  ${py(e.key)}: ${py(e.value ?? '')},`), '}')
    out.push(
      'files = [',
      ...fl.flatMap((e) => files(e.src).map((f) => `  (${py(e.key)}, (${py(fileName(f))}, open(${py(f)}, "rb"), ${py(e.contentType || mimeFromPath(f))})),`)),
      ']'
    )
    call += ', headers=headers, data=payload, files=files'
  } else if (b?.mode === 'file' && b.file?.src) {
    out.push(`payload = open(${py(b.file.src)}, "rb")`)
    call += ', headers=headers, data=payload'
  } else call += ', headers=headers'
  const hs = r.headers.filter(([k]) => !(b?.mode === 'formdata' && k.toLowerCase() === 'content-type'))
  out.push('headers = {', ...hs.map(([k, v]) => `  ${py(k)}: ${py(v)},`), '}', '')
  out.push(`${call})`, '', 'print(response.text)')
  return out.join('\n')
}
