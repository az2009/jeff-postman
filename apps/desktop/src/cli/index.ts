/**
 * jeff-postman: roda collections pelo terminal, como o Newman.
 *   jeff-postman run <collection.json> [-e env.json] [-g globals.json] [-d dados.csv|json] [-n N]
 *     [--folder "Pasta"] [--delay-request ms] [--bail] [--env-var k=v] [--global-var k=v]
 *     [--reporters cli,json] [--reporter-json-export arquivo.json] [--no-color] [--silent]
 * Código de saída: 0 tudo certo; 1 teste reprovado ou erro; 2 uso inválido.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'

// o SQLite do Node ainda avisa que é experimental; no terminal isso só polui a saída
const emit = process.emitWarning.bind(process)
process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
  const msg = typeof w === 'string' ? w : w.message
  if (/SQLite is an experimental feature/.test(msg)) return
  return (emit as (...a: unknown[]) => void)(w, ...rest)
}) as typeof process.emitWarning

const VERSION = '0.1.0'

interface Args {
  cmd: string | null
  file: string | null
  env: string | null
  globals: string | null
  data: string | null
  iterations: number | null
  folder: string | null
  delay: number
  bail: boolean
  envVars: [string, string][]
  globalVars: [string, string][]
  reporters: string[]
  jsonExport: string | null
  color: boolean
  silent: boolean
  insecure: boolean
  timeoutRequest: number
  extraCa: string | null
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    cmd: null,
    file: null,
    env: null,
    globals: null,
    data: null,
    iterations: null,
    folder: null,
    delay: 0,
    bail: false,
    envVars: [],
    globalVars: [],
    reporters: ['cli'],
    jsonExport: null,
    color: process.stdout.isTTY ?? false,
    silent: false,
    insecure: false,
    timeoutRequest: 0,
    extraCa: null
  }
  const kv = (s: string): [string, string] => {
    const i = s.indexOf('=')
    if (i < 1) fail(`esperado chave=valor: ${s}`)
    return [s.slice(0, i), s.slice(i + 1)]
  }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) fail(`faltou o valor de ${t}`)
      return v
    }
    switch (t) {
      case '-e':
      case '--environment':
        a.env = next()
        break
      case '-g':
      case '--globals':
        a.globals = next()
        break
      case '-d':
      case '--iteration-data':
        a.data = next()
        break
      case '-n':
      case '--iteration-count':
        a.iterations = Number(next())
        break
      case '--folder':
        a.folder = next()
        break
      case '--delay-request':
        a.delay = Number(next())
        break
      case '--bail':
        a.bail = true
        break
      case '-k':
      case '--insecure':
        a.insecure = true
        break
      case '--timeout-request':
        a.timeoutRequest = Number(next())
        break
      case '--ssl-extra-ca-certs':
        a.extraCa = next()
        break
      case '--env-var':
        a.envVars.push(kv(next()))
        break
      case '--global-var':
        a.globalVars.push(kv(next()))
        break
      case '-r':
      case '--reporters':
        a.reporters = next().split(',').map((x) => x.trim())
        break
      case '--reporter-json-export':
        a.jsonExport = next()
        break
      case '--no-color':
        a.color = false
        break
      case '--silent':
        a.silent = true
        break
      case '-h':
      case '--help':
        usage(0)
        break
      case '-v':
      case '--version':
        console.log(VERSION)
        process.exit(0)
        break
      default:
        if (t.startsWith('-')) fail(`opção desconhecida: ${t}`)
        if (!a.cmd) a.cmd = t
        else if (!a.file) a.file = t
        else fail(`argumento a mais: ${t}`)
    }
  }
  return a
}

function usage(code: number): never {
  console.log(`jeff-postman ${VERSION}: roda collections do Postman/JEFF Postman pelo terminal

Uso:
  jeff-postman run <collection.json> [opções]

Opções:
  -e, --environment <arquivo>      environment (.postman_environment.json)
  -g, --globals <arquivo>          globals (.postman_globals.json)
  -d, --iteration-data <arquivo>   data file CSV ou JSON (uma iteração por linha)
  -n, --iteration-count <N>        número de iterações (padrão: linhas do data file ou 1)
      --folder <nome>              roda só esta pasta
      --delay-request <ms>         intervalo entre requisições
      --bail                       para no primeiro erro
  -k, --insecure                   não verifica o certificado SSL
      --timeout-request <ms>       tempo máximo de cada requisição
      --ssl-extra-ca-certs <pem>   CA extra (PEM) além das do sistema
      --env-var chave=valor        sobrescreve variável do environment (pode repetir)
      --global-var chave=valor     sobrescreve variável global (pode repetir)
  -r, --reporters cli,json         relatórios (padrão: cli)
      --reporter-json-export <arq> onde gravar o relatório json
      --no-color, --silent
  -h, --help, -v, --version

Saída: 0 = tudo passou; 1 = teste reprovado ou erro; 2 = uso inválido.`)
  process.exit(code)
}

function fail(msg: string): never {
  console.error(`jeff-postman: ${msg}\nUse jeff-postman --help para ver as opções.`)
  process.exit(2)
}

function readJson(path: string, what: string): unknown {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8').replace(/^﻿/, ''))
  } catch (e) {
    fail(`não consegui ler ${what} (${path}): ${(e as Error).message}`)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.cmd) usage(2)
  if (args.cmd !== 'run') fail(`comando desconhecido: ${args.cmd}`)
  if (!args.file) fail('informe o arquivo da collection')

  // módulos que usam node:sqlite só depois do filtro de avisos
  const { Repo } = await import('../main/db')
  const { parsePostman } = await import('@shared/postman')
  const { parseDataFile } = await import('@shared/datafile')
  const { startRun, exportRun, requestOrder } = await import('../main/runner')
  const { stopSandbox } = await import('../main/scripts')

  const repo = new Repo(':memory:')
  const st = repo.getSettings()
  if (args.insecure) st.sslVerification = false
  if (args.timeoutRequest > 0) st.requestTimeoutMs = args.timeoutRequest
  if (args.extraCa) st.ca = { enabled: true, path: resolve(args.extraCa) }
  repo.setSettings(st)
  const col = parsePostman(readJson(args.file, 'a collection'))
  if (col.kind !== 'collection') fail(`${args.file} não é uma collection`)
  const c = repo.importCollection(col.data)

  let envId: string | null = null
  if (args.env || args.envVars.length) {
    const values = args.env ? (() => {
      const p = parsePostman(readJson(args.env!, 'o environment'))
      if (p.kind === 'collection') fail(`${args.env} não é um environment`)
      return p.data.values
    })() : []
    for (const [k, v] of args.envVars) {
      const cur = values.find((x) => x.key === k)
      if (cur) cur.value = v
      else values.push({ key: k, value: v })
    }
    envId = repo.createEnvironment(args.env ? basename(args.env).replace(/\.postman_environment\.json$|\.json$/i, '') : 'cli', values).id
  }
  if (args.globals || args.globalVars.length) {
    const values = args.globals ? (() => {
      const p = parsePostman(readJson(args.globals!, 'as globals'))
      if (p.kind === 'collection') fail(`${args.globals} não é um arquivo de globals`)
      return p.data.values
    })() : []
    for (const [k, v] of args.globalVars) {
      const cur = values.find((x) => x.key === k)
      if (cur) cur.value = v
      else values.push({ key: k, value: v })
    }
    repo.setGlobals(values)
  }

  let data: Record<string, string>[] | null = null
  if (args.data) {
    try {
      data = parseDataFile(args.data, readFileSync(resolve(args.data), 'utf8')).rows
    } catch (e) {
      fail(`data file inválido (${args.data}): ${(e as Error).message}`)
    }
  }

  let folderId: string | null = null
  if (args.folder) {
    const f = repo.listItems(c.id).find((i) => i.kind === 'folder' && i.name === args.folder)
    if (!f) fail(`pasta não encontrada: ${args.folder}`)
    folderId = f.id
  }
  const order = requestOrder(repo, c.id, folderId)
  if (!order.length) fail('a collection (ou pasta) não tem requisições')

  const paint = (code: string) => (s: string) => (args.color ? `\x1b[${code}m${s}\x1b[0m` : s)
  const green = paint('32')
  const red = paint('31')
  const gray = paint('90')
  const bold = paint('1')
  const out = (s: string) => !args.silent && args.reporters.includes('cli') && process.stdout.write(s + '\n')

  out(`${bold('jeff-postman')}\n\n${bold(col.data.name)}${args.folder ? ` / ${args.folder}` : ''}`)
  let lastIter = -1
  const iterations = args.iterations ?? (data?.length || 1)
  if (!Number.isFinite(iterations) || iterations < 1) fail('-n precisa ser um número maior que zero')

  const finished = await new Promise<import('@shared/types').RunSummary>((done) => {
    startRun(
      repo,
      {
        collectionId: c.id,
        folderId,
        requestIds: [],
        iterations,
        delayMs: args.delay,
        data,
        dataFileName: args.data ? basename(args.data) : null,
        environmentId: envId,
        keepVariableValues: false,
        stopOnError: args.bail,
        saveResponses: false
      },
      VERSION,
      (ev) => {
        if (ev.type === 'result') {
          const r = ev.result
          if (r.iteration !== lastIter && iterations > 1) out(`\n${gray(`Iteração ${r.iteration + 1}/${iterations}`)}`)
          lastIter = r.iteration
          out(`\n→ ${r.name}`)
          if (r.skipped) out(gray('  (pulada por pm.execution.skipRequest)'))
          else if (r.status !== null) out(`  ${r.method} ${r.url} ${gray(`[${r.status} ${r.statusText}, ${r.size}B, ${r.timeMs}ms]`)}`)
          for (const t of r.tests) out(t.skipped ? gray(`  -  ${t.name} (skipped)`) : t.passed ? `  ${green('✓')}  ${t.name}` : `  ${red('✗')}  ${t.name}\n     ${red(t.error ?? '')}`)
          if (r.error) out(red(`  ! ${r.error}`))
        }
        if (ev.type === 'finished') done(ev.summary)
      }
    )
  })

  const run = repo.getRun(finished.id)!
  const total = run.results.reduce((a, r) => a + r.tests.filter((t) => !t.skipped).length, 0)
  out(
    `\n┌─────────────────────────┬──────────┬──────────┐\n` +
      `│                         │ executado│  falhou  │\n` +
      `├─────────────────────────┼──────────┼──────────┤\n` +
      `│ iterações               │ ${String(iterations).padStart(8)} │ ${String(0).padStart(8)} │\n` +
      `│ requisições             │ ${String(finished.executed).padStart(8)} │ ${String(finished.errors).padStart(8)} │\n` +
      `│ testes                  │ ${String(total).padStart(8)} │ ${String(finished.testsFailed).padStart(8)} │\n` +
      `├─────────────────────────┴──────────┴──────────┤\n` +
      `│ ${`duração: ${(finished.totalMs / 1000).toFixed(2)} s   tempo médio: ${finished.avgMs} ms`.padEnd(45)} │\n` +
      `└${'─'.repeat(47)}┘`
  )
  if (finished.message) out(gray(finished.message))

  if (args.reporters.includes('json') || args.jsonExport) {
    const path = resolve(args.jsonExport ?? `jeff-postman-run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(path, JSON.stringify(exportRun(finished, run.results), null, 2), 'utf8')
    out(gray(`relatório json: ${path}`))
  }

  const failed = finished.testsFailed > 0 || finished.errors > 0 || finished.status === 'error'
  stopSandbox()
  repo.close()
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(`jeff-postman: erro inesperado: ${(e as Error).stack ?? e}`)
  process.exit(1)
})
