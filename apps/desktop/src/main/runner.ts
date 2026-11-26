/**
 * Collection Runner: roda uma collection (ou pasta) por N iterações, com data file, intervalo,
 * setNextRequest/skipRequest, parada no erro e gravação dos resultados. Não entra no histórico.
 */
import { randomUUID } from 'node:crypto'
import type { KeyValue, RequestDoc, RunConfig, RunnerEvent, RunRequestResult, RunSummary, ScriptsReport, TreeItem } from '@shared/types'
import type { Repo } from './db'
import { clean, executeRequest, type RunContext } from './execute'
import { cancel } from './http'
import { bodyInfo } from '@shared/binary'

interface RunFlag {
  stop: boolean
  paused: boolean
  requestId: string | null
}

const active = new Map<string, { flag: RunFlag; summary: RunSummary; emit: (e: RunnerEvent) => void }>()

/** Requisições de uma collection (ou pasta) na ordem da árvore (pastas de cima para baixo, em profundidade). */
export function requestOrder(repo: Repo, collectionId: string, folderId: string | null) {
  const items = repo.listItems(collectionId)
  const kids = new Map<string | null, TreeItem[]>()
  for (const i of items) {
    const l = kids.get(i.parentId) ?? []
    l.push(i)
    kids.set(i.parentId, l)
  }
  for (const l of kids.values()) l.sort((a, b) => a.sortOrder - b.sortOrder)
  const out: { id: string; name: string; method: string; path: string }[] = []
  const walk = (parent: string | null, path: string[]) => {
    for (const i of kids.get(parent) ?? []) {
      if (i.kind === 'folder') walk(i.id, [...path, i.name])
      else out.push({ id: i.id, name: i.name, method: i.method ?? 'GET', path: path.join(' / ') })
    }
  }
  if (folderId) {
    const f = items.find((i) => i.id === folderId)
    walk(folderId, f ? [f.name] : [])
  } else walk(null, [])
  return out
}

export function stopRun(runId: string): void {
  const a = active.get(runId)
  if (!a) return
  a.flag.stop = true
  if (a.flag.requestId) cancel(a.flag.requestId)
}

/**
 * Pausa ou retoma a execução. A requisição em andamento termina normalmente; a próxima só sai
 * depois do Resume (o intervalo entre requisições também espera).
 */
export function pauseRun(runId: string, paused: boolean): void {
  const a = active.get(runId)
  if (!a || a.flag.stop || a.flag.paused === paused) return
  a.flag.paused = paused
  a.summary.paused = paused
  a.summary.totalMs = Date.now() - a.summary.startedAt
  a.emit({ type: 'state', summary: { ...a.summary } })
}

export function startRun(repo: Repo, cfg: RunConfig, appVersion: string, emit: (e: RunnerEvent) => void): RunSummary {
  const col = repo.listCollections().find((c) => c.id === cfg.collectionId)
  if (!col) throw new Error('Collection não encontrada')
  const folderName = cfg.folderId ? repo.getFolder(cfg.folderId)?.name : null
  const env = cfg.environmentId ? repo.getEnvironment(cfg.environmentId) : null
  const order = requestOrder(repo, cfg.collectionId, cfg.folderId)
  const selected = cfg.requestIds.length ? cfg.requestIds.filter((id) => order.some((o) => o.id === id)) : order.map((o) => o.id)
  if (!selected.length) throw new Error('Nenhuma requisição selecionada para rodar')
  const iterations = Math.max(1, Math.min(Math.floor(cfg.iterations) || 1, 100000))

  const summary: RunSummary = {
    id: randomUUID(),
    collectionId: cfg.collectionId,
    folderId: cfg.folderId,
    name: folderName ? `${col.name} / ${folderName}` : col.name,
    environmentName: env?.name ?? null,
    dataFileName: cfg.dataFileName,
    startedAt: Date.now(),
    finishedAt: null,
    status: 'running',
    iterations,
    executed: 0,
    testsPassed: 0,
    testsFailed: 0,
    errors: 0,
    avgMs: 0,
    totalMs: 0
  }
  const storedCfg = { ...cfg, data: cfg.data ? { rows: cfg.data.length } : null }
  repo.saveRun(summary, storedCfg)
  const flag: RunFlag = { stop: false, paused: false, requestId: null }
  active.set(summary.id, { flag, summary, emit })
  emit({ type: 'started', summary: { ...summary } })

  // roda em segundo plano; a tela acompanha pelos eventos
  void (async () => {
    const ctx: RunContext = {
      globals: repo.getGlobals(),
      collectionVariables: repo.getCollectionVariables(cfg.collectionId),
      environment: env ? env.values.map((v) => ({ ...v })) : null,
      environmentName: env?.name ?? null,
      iterationData: [],
      iteration: 0,
      iterationCount: iterations
    }
    const names = new Map(selected.map((id) => [id, order.find((o) => o.id === id)!.name]))
    let seq = 0
    let timeSum = 0
    try {
      outer: for (let it = 0; it < iterations; it++) {
        if (flag.stop) break
        const row = cfg.data?.length ? cfg.data[Math.min(it, cfg.data.length - 1)] : null
        ctx.iterationData = row ? Object.entries(row).map(([key, value]): KeyValue => ({ key, value })) : []
        ctx.iteration = it
        let idx = 0
        let steps = 0
        while (idx < selected.length) {
          if (flag.paused) await waitWhilePaused(flag)
          if (flag.stop) break outer
          if (steps++ > 10000) {
            summary.message = 'Mais de 10.000 passos numa iteração (setNextRequest em laço?); iteração interrompida'
            break
          }
          const itemId = selected[idx]
          const doc = repo.getRequest(itemId) as RequestDoc | null
          if (!doc) {
            idx++
            continue
          }
          const requestId = randomUUID()
          flag.requestId = requestId
          const r = await executeRequest(
            repo,
            { requestId, doc, environmentId: cfg.environmentId, collectionId: cfg.collectionId, itemId },
            appVersion,
            ctx
          )
          flag.requestId = null
          const report = r.ok ? r.response.scripts : r.scripts
          const tests = (report?.tests ?? []).map(({ name, passed, skipped, error }) => ({ name, passed, skipped, ...(error ? { error } : {}) }))
          const scriptError = report?.errors.map((e) => `${e.source}: ${e.error}`).join('; ') || null
          const res: RunRequestResult = {
            seq: ++seq,
            iteration: it,
            itemId,
            name: doc.name,
            method: r.ok ? r.response.request.method : doc.request.method,
            url: r.ok ? r.response.request.url : (r.request?.url ?? doc.request.url.raw),
            status: r.ok ? r.response.status : null,
            statusText: r.ok ? r.response.statusText : '',
            timeMs: r.ok ? Math.round(r.response.timings.total) : 0,
            size: r.ok ? r.response.headersSize + r.response.bodySize : 0,
            tests,
            error: r.ok ? scriptError : r.cancelled ? 'Parado' : r.skipped ? null : r.error,
            skipped: !r.ok && !!r.skipped
          }
          res.at = Date.now()
          if (report) {
            const kept = limitLogs(report.logs)
            if (kept.logs.length) res.logs = kept.logs
            if (kept.truncated) res.logsTruncated = true
            if (report.errors.length) res.scriptErrors = report.errors.slice(0, 50).map((x) => ({ ...x, error: x.error.slice(0, 4000) }))
          }
          const sent = r.ok ? r.response.request : r.request
          if (sent) {
            res.requestHeaders = sent.headers
            if (sent.bodyPreview) res.requestBody = sent.bodyPreview
          }
          if (r.ok) {
            res.responseHeaders = r.response.headers
            res.httpVersion = r.response.httpVersion
          }
          const info = r.ok ? bodyInfo(r.response.body, r.response.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1]) : null
          if (cfg.saveResponses && r.ok && info && info.kind !== 'text') res.responseBinary = { mime: info.mime, size: r.response.body.byteLength }
          else if (cfg.saveResponses && r.ok) {
            const b = Buffer.from(r.response.body)
            res.responseBody = b.subarray(0, 64 * 1024).toString('utf8') + (b.length > 64 * 1024 ? `\n… (${b.length - 64 * 1024} bytes a mais)` : '')
          }
          summary.executed++
          summary.testsPassed += tests.filter((t) => t.passed).length
          summary.testsFailed += tests.filter((t) => !t.passed && !t.skipped).length
          const cancelled = !r.ok && r.cancelled
          if (res.error && !cancelled) summary.errors++
          timeSum += res.timeMs
          summary.avgMs = Math.round(timeSum / summary.executed)
          summary.totalMs = Date.now() - summary.startedAt
          repo.saveRunResult(summary.id, res)
          emit({ type: 'result', runId: summary.id, result: res, summary: { ...summary } })

          if (cfg.stopOnError && res.error && !cancelled) {
            summary.message = `Parado no erro: ${res.name}`
            flag.stop = true
            break outer
          }
          // setNextRequest: nome dentro das requisições desta execução; null encerra a iteração
          const next = report?.nextRequest
          if (next === null) break
          if (typeof next === 'string') {
            const j = selected.findIndex((id) => names.get(id) === next)
            if (j < 0) {
              summary.message = `setNextRequest("${next}"): requisição não está nesta execução; iteração encerrada`
              break
            }
            idx = j
          } else idx++
          if (cfg.delayMs > 0 && !flag.stop) await sleep(cfg.delayMs, flag)
        }
      }
      summary.status = flag.stop ? 'stopped' : 'finished'
      if (cfg.keepVariableValues) {
        repo.setGlobals(clean(ctx.globals))
        repo.setCollectionVariables(cfg.collectionId, clean(ctx.collectionVariables))
        if (cfg.environmentId && ctx.environment && repo.getEnvironment(cfg.environmentId)) repo.updateEnvironment(cfg.environmentId, { values: clean(ctx.environment) })
      }
    } catch (e) {
      summary.status = 'error'
      summary.message = (e as Error).message
    } finally {
      summary.paused = false
      summary.finishedAt = Date.now()
      summary.totalMs = summary.finishedAt - summary.startedAt
      repo.saveRun(summary, storedCfg)
      active.delete(summary.id)
      emit({ type: 'finished', summary: { ...summary } })
    }
  })()
  return { ...summary }
}

const MAX_LOG_LINES = 200
const MAX_LOG_CHARS = 32 * 1024

/** Logs guardados por requisição no Runner: até 200 linhas e 32 KB de texto, para 1000 iterações não pesarem. */
export function limitLogs(logs: ScriptsReport['logs']): { logs: ScriptsReport['logs']; truncated: boolean } {
  const out: ScriptsReport['logs'] = []
  let chars = 0
  for (const l of logs) {
    if (out.length >= MAX_LOG_LINES || chars >= MAX_LOG_CHARS) return { logs: out, truncated: true }
    const room = MAX_LOG_CHARS - chars
    const text = l.text.length > room ? `${l.text.slice(0, room)}… (cortado)` : l.text
    chars += text.length
    out.push({ ...l, text })
  }
  return { logs: out, truncated: false }
}

/** Intervalo entre requisições; o tempo pausado não conta. */
function sleep(ms: number, flag: RunFlag): Promise<void> {
  return new Promise((resolve) => {
    let left = ms
    let last = Date.now()
    const tick = () => {
      const now = Date.now()
      if (!flag.paused) left -= now - last
      last = now
      if (flag.stop || left <= 0) resolve()
      else setTimeout(tick, Math.min(50, Math.max(1, left)))
    }
    tick()
  })
}

function waitWhilePaused(flag: RunFlag): Promise<void> {
  return new Promise((resolve) => {
    const tick = () => (!flag.paused || flag.stop ? resolve() : setTimeout(tick, 50))
    tick()
  })
}

/** Resultado no formato de exportação do Runner do Postman (simplificado). */
export function exportRun(summary: RunSummary, results: RunRequestResult[]) {
  const byItem = new Map<string, RunRequestResult[]>()
  for (const r of results) byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), r])
  return {
    id: summary.id,
    name: summary.name,
    timestamp: new Date(summary.startedAt).toISOString(),
    collection_id: summary.collectionId,
    folder_id: summary.folderId,
    environment_name: summary.environmentName,
    data_file: summary.dataFileName,
    totalPass: summary.testsPassed,
    totalFail: summary.testsFailed,
    count: summary.iterations,
    totalTime: summary.totalMs,
    status: summary.status,
    results: [...byItem.entries()].map(([id, rs]) => {
      const tests: Record<string, boolean> = {}
      const counts: Record<string, { pass: number; fail: number }> = {}
      for (const r of rs)
        for (const t of r.tests) {
          tests[t.name] = t.passed
          counts[t.name] ??= { pass: 0, fail: 0 }
          if (t.passed) counts[t.name].pass++
          else if (!t.skipped) counts[t.name].fail++
        }
      const last = rs[rs.length - 1]
      return {
        id,
        name: last.name,
        url: last.url,
        method: last.method,
        time: Math.round(rs.reduce((a, r) => a + r.timeMs, 0) / rs.length),
        responseCode: { code: last.status, name: last.statusText },
        tests,
        testPassFailCounts: counts,
        times: rs.map((r) => r.timeMs),
        allTests: rs.map((r) => Object.fromEntries(r.tests.map((t) => [t.name, t.passed])))
      }
    }),
    executions: results
  }
}
