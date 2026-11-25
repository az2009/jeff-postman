/** Worker dos scripts: roda fora da thread principal; o main pode encerrá-lo se passar do prazo. */
import { parentPort } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import { runScript } from './run'
import { send } from '../http'
import type { AppSettings, ScriptInput, SendRequestSpec, SendRequestReply } from '@shared/types'

async function sendRequest(req: SendRequestSpec, appVersion: string, settings?: AppSettings): Promise<SendRequestReply> {
  const r = await send(
    {
      requestId: randomUUID(),
      doc: { name: 'pm.sendRequest', request: { method: req.method as never, url: { raw: req.url }, header: req.header, body: req.body } },
      environmentId: null,
      collectionId: null,
      itemId: null
    },
    appVersion,
    { settings }
  )
  if (!r.ok) return { error: r.error }
  const res = r.response
  return {
    response: {
      code: res.status,
      status: res.statusText,
      headers: res.headers,
      body: Buffer.from(res.body).toString('utf8'),
      responseTime: Math.round(res.timings.total)
    }
  }
}

parentPort!.on('message', async (msg: { id: number; input: ScriptInput; appVersion: string }) => {
  try {
    const result = await runScript(msg.input, { sendRequest: (req) => sendRequest(req, msg.appVersion, msg.input.httpSettings) })
    parentPort!.postMessage({ id: msg.id, result })
  } catch (e) {
    parentPort!.postMessage({ id: msg.id, result: { state: null, tests: [], logs: [], nextRequest: undefined, skip: false, error: String(e) } })
  }
})
