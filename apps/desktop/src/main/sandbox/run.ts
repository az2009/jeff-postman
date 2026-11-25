/**
 * Executa um script (pre-request ou post-response) num contexto vm isolado, com a API pm.
 * - o contexto nasce de um objeto sem protótipo, então `this.constructor.constructor` não chega ao Node;
 * - só texto cruza a fronteira (JSON), nunca objetos do lado de fora;
 * - todo código do usuário (inclusive callbacks de timer e de pm.sendRequest) roda com tempo limite;
 * - lodash, moment, crypto-js e tv4 só são carregados quando usados.
 */
import vm from 'node:vm'
import runtimeSrc from './pm-runtime.js?raw'
import chaiSrc from 'chai/chai.js?raw'
import lodashSrc from 'lodash/lodash.min.js?raw'
import momentSrc from 'moment/min/moment.min.js?raw'
import cryptoSrc from 'crypto-js/crypto-js.js?raw'
import tv4Src from 'tv4/tv4.js?raw'
import type { ScriptInput, ScriptRunResult, SendRequestSpec, SendRequestReply } from '@shared/types'

const compiled = new Map<string, vm.Script>()
function script(name: string, src: string): vm.Script {
  let s = compiled.get(name)
  if (!s) {
    s = new vm.Script(src, { filename: name })
    compiled.set(name, s)
  }
  return s
}

const LIBS: Record<string, { src: string; global: string }> = {
  lodash: { src: lodashSrc, global: '_' },
  moment: { src: momentSrc, global: 'moment' },
  'crypto-js': { src: cryptoSrc, global: 'CryptoJS' },
  tv4: { src: tv4Src, global: 'tv4' }
}

export interface RunDeps {
  sendRequest(req: SendRequestSpec): Promise<SendRequestReply>
}

export async function runScript(input: ScriptInput, deps: RunDeps): Promise<ScriptRunResult> {
  const timeout = input.timeoutMs ?? 5000
  const deadline = Date.now() + (input.deadlineMs ?? 15000)
  const sandbox = Object.create(null) as Record<string, unknown>
  const ctx = vm.createContext(sandbox, { name: 'pm-sandbox', codeGeneration: { strings: true, wasm: false } })
  const timers = new Map<number, NodeJS.Timeout>()
  const network: NonNullable<ScriptRunResult['network']> = []
  const run = (code: string) => vm.runInContext(code, ctx, { timeout })
  const deliver = (id: number, payload: unknown) => {
    try {
      run(`__deliver(${id}, ${JSON.stringify(JSON.stringify(payload))})`)
    } catch (e) {
      asyncError ??= errText(e)
    }
  }
  let asyncError: string | null = null

  // única função de fora visível ao contexto: recebe e devolve só texto
  sandbox.__host = (msg: unknown): string => {
    try {
      if (typeof msg !== 'string') return JSON.stringify({ error: 'mensagem inválida' })
      const op = JSON.parse(msg) as { op: string; id?: number; name?: string; ms?: number; req?: SendRequestSpec }
      switch (op.op) {
        case 'lib': {
          const lib = LIBS[op.name ?? '']
          if (!lib) return JSON.stringify({ error: 'biblioteca desconhecida' })
          script(op.name!, lib.src).runInContext(ctx, { timeout })
          return JSON.stringify({ ok: true })
        }
        case 'timer': {
          const id = op.id!
          timers.set(
            id,
            setTimeout(() => {
              timers.delete(id)
              deliver(id, {})
            }, op.ms ?? 0)
          )
          return JSON.stringify({ ok: true })
        }
        case 'clearTimer': {
          const t = timers.get(op.id!)
          if (t) clearTimeout(t)
          timers.delete(op.id!)
          return JSON.stringify({ ok: true })
        }
        case 'sendRequest': {
          const id = op.id!
          const t0 = Date.now()
          const note = (status: number | null, error?: string) =>
            network.push({ method: op.req!.method, url: op.req!.url, status, ms: Date.now() - t0, ...(error ? { error } : {}) })
          deps
            .sendRequest(op.req!)
            .then((r) => {
              note('response' in r ? r.response.code : null, 'error' in r ? r.error : undefined)
              deliver(id, r)
            })
            .catch((e) => {
              note(null, errText(e))
              deliver(id, { error: errText(e) })
            })
          return JSON.stringify({ ok: true })
        }
        default:
          return JSON.stringify({ error: `operação desconhecida: ${op.op}` })
      }
    } catch (e) {
      return JSON.stringify({ error: errText(e) })
    }
  }
  sandbox.__input = JSON.stringify({ state: input.state, info: input.info })

  let error: string | null = null
  try {
    script('chai.js', chaiSrc).runInContext(ctx, { timeout })
    // bibliotecas preguiçosas: o getter carrega na primeira vez que o script usa
    run(
      Object.entries(LIBS)
        .map(
          ([name, l]) =>
            `Object.defineProperty(globalThis, ${JSON.stringify(l.global)}, { configurable: true, get: function () { delete globalThis[${JSON.stringify(l.global)}]; __loadLib(${JSON.stringify(name)}); return globalThis[${JSON.stringify(l.global)}] } });`
        )
        .join('\n') +
        `\nvar __loadLib = (function (h) { return function (n) { var r = JSON.parse(h(JSON.stringify({ op: 'lib', name: n }))); if (r && r.error) throw new Error(r.error) } })(globalThis.__host);`
    )
    script('pm-runtime.js', runtimeSrc).runInContext(ctx, { timeout })
    run(
      `globalThis.__mainDone = false; globalThis.__mainErr = null;\n` +
        `(async function () {\n${input.script}\n})().then(function () { __mainDone = true }, function (e) { __mainErr = (e && e.name ? e.name + ': ' : '') + (e && e.message !== undefined ? e.message : String(e)); __mainDone = true });`
    )
  } catch (e) {
    error = errText(e)
  }

  // espera promessas, timers e pm.sendRequest terminarem (ou o prazo acabar)
  if (!error) {
    for (;;) {
      await new Promise((r) => setImmediate(r))
      let st: { done: boolean; pending: number; err: string | null }
      try {
        st = JSON.parse(run('JSON.stringify({ done: !!globalThis.__mainDone, pending: __pending(), err: globalThis.__mainErr ? String(globalThis.__mainErr) : null })'))
      } catch (e) {
        error = errText(e)
        break
      }
      if (st.done && st.pending === 0) {
        error = st.err
        break
      }
      if (Date.now() > deadline) {
        error = `O script não terminou em ${Math.round((input.deadlineMs ?? 15000) / 1000)} s (promessas, timers ou pm.sendRequest pendentes)`
        break
      }
      await new Promise((r) => setTimeout(r, 4))
    }
  }
  for (const t of timers.values()) clearTimeout(t)

  let out: ScriptRunResult
  try {
    const r = JSON.parse(run('__result()')) as Omit<ScriptRunResult, 'error'>
    out = { ...r, network, error: error ?? asyncError }
  } catch (e) {
    out = { state: null, tests: [], logs: [], network, nextRequest: undefined, skip: false, error: error ?? errText(e) }
  }
  return out
}

function errText(e: unknown): string {
  const err = e as { name?: string; message?: string; code?: string }
  if (err?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return 'O script passou do tempo limite (laço infinito?) e foi interrompido'
  if (err && typeof err === 'object' && 'message' in err) return `${err.name ?? 'Error'}: ${err.message}`
  return String(e)
}
