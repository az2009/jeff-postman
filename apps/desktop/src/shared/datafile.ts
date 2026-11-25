/** Leitura de data files do Runner: CSV (vírgula ou ponto e vírgula, com aspas) e JSON (array de objetos). */

export interface DataFile {
  columns: string[]
  rows: Record<string, string>[]
}

/** CSV no padrão RFC 4180: aspas, aspas duplicadas, quebra de linha dentro de aspas, BOM, CRLF. */
export function parseCsv(text: string): DataFile {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const records: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      cell += c
      i++
      continue
    }
    if (c === '"' && cell === '') {
      quoted = true
      i++
    } else if (c === sep) {
      row.push(cell)
      cell = ''
      i++
    } else if (c === '\r' || c === '\n') {
      row.push(cell)
      records.push(row)
      row = []
      cell = ''
      i += c === '\r' && src[i + 1] === '\n' ? 2 : 1
    } else {
      cell += c
      i++
    }
  }
  if (quoted) throw new Error('CSV inválido: aspas abertas sem fechar')
  if (cell !== '' || row.length) {
    row.push(cell)
    records.push(row)
  }
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''))
  if (nonEmpty.length === 0) throw new Error('O arquivo CSV está vazio')
  const columns = nonEmpty[0].map((c) => c.trim())
  if (columns.some((c) => !c)) throw new Error('O CSV tem coluna sem nome na primeira linha')
  const rows = nonEmpty.slice(1).map((r) => Object.fromEntries(columns.map((c, j) => [c, r[j] ?? ''])))
  return { columns, rows }
}

export function parseJsonData(text: string): DataFile {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^﻿/, ''))
  } catch (e) {
    throw new Error(`JSON inválido: ${(e as Error).message}`)
  }
  if (!Array.isArray(data)) throw new Error('O arquivo JSON precisa ser um array de objetos: [{ "campo": "valor" }, ...]')
  const columns: string[] = []
  const rows = data.map((r, i) => {
    if (typeof r !== 'object' || r === null || Array.isArray(r)) throw new Error(`Item ${i + 1} do JSON não é um objeto`)
    const o: Record<string, string> = {}
    for (const [k, v] of Object.entries(r)) {
      if (!columns.includes(k)) columns.push(k)
      o[k] = typeof v === 'string' ? v : v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    }
    return o
  })
  return { columns, rows }
}

export function parseDataFile(name: string, text: string): DataFile {
  const t = text.replace(/^﻿/, '').trimStart()
  if (/\.json$/i.test(name) || t.startsWith('[')) return parseJsonData(text)
  return parseCsv(text)
}
