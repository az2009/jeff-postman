/** Gerencia o worker dos scripts: um worker reaproveitado; se um script estourar o prazo, o worker é encerrado e recriado. */
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { ScriptInput, ScriptRunResult } from '@shared/types'

let worker: Worker | null = null
let seq = 0
const waiting = new Map<number, (r: ScriptRunResult) => void>()

const failed = (error: string): ScriptRunResult => ({ state: null, tests: [], logs: [], nextRequest: undefined, skip: false, error })

function getWorker(): Worker {
  if (worker) return worker
  // o worker fica ao lado do bundle principal; num build com chunks, o código pode estar uma pasta abaixo
  const file = [join(__dirname, 'sandbox.js'), join(__dirname, '..', 'sandbox.js')].find((f) => existsSync(f)) ?? join(__dirname, 'sandbox.js')
  const w = new Worker(file, { resourceLimits: { maxOldGenerationSizeMb: 256 } })
  w.on('message', (m: { id: number; result: ScriptRunResult }) => {
    waiting.get(m.id)?.(m.result)
    waiting.delete(m.id)
  })
  const down = (why: string) => {
    if (worker === w) worker = null
    for (const [id, cb] of waiting) {
      cb(failed(why))
      waiting.delete(id)
    }
  }
  w.on('error', (e: Error) => down(`O ambiente de scripts falhou: ${e.message}`))
  w.on('exit', (code) => down(code === 0 ? 'O ambiente de scripts foi encerrado' : `O ambiente de scripts caiu (código ${code}); memória acima do limite?`))
  worker = w
  return w
}

export function runInSandbox(input: ScriptInput, appVersion: string): Promise<ScriptRunResult> {
  const hard = (input.deadlineMs ?? 15000) + 5000
  return new Promise((resolve) => {
    const id = ++seq
    const w = getWorker()
    const timer = setTimeout(() => {
      waiting.delete(id)
      // travou de um jeito que o vm não conseguiu parar: derruba o worker inteiro
      w.terminate()
      if (worker === w) worker = null
      resolve(failed(`O script não respondeu em ${Math.round(hard / 1000)} s e o ambiente de scripts foi reiniciado`))
    }, hard)
    waiting.set(id, (r) => {
      clearTimeout(timer)
      resolve(r)
    })
    w.postMessage({ id, input, appVersion })
  })
}

export function stopSandbox(): void {
  worker?.terminate()
  worker = null
}
