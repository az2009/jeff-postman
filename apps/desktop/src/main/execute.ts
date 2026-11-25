/**
 * Envio completo de uma requisição, na ordem do Postman:
 * pre-request (collection → pastas → requisição) → resolver variáveis e auth → enviar →
 * post-response (collection → pastas → requisição) → gravar variáveis alteradas pelos scripts.
 */
import type { KeyValue, PmAuth, PmEvent, RequestDoc, ScriptsReport, ScriptState, SendInput, SendResult } from '@shared/types'
import { makeLookup, resolveDoc, type Scope } from '@shared/variables'
import { getBool, getParam, resolveAuth } from '@shared/auth'
import type { Repo } from './db'
import { send } from './http'
import { runInSandbox } from './scripts'
import { CookieJar } from '@shared/cookies'
import { configFrom, refreshToken } from './oauth2-core'

interface ScriptRef {
  source: string
  code: string
}

/** Scripts de um evento, do mais externo (collection) ao mais interno (requisição). */
function collectScripts(repo: Repo, input: SendInput, event: 'prerequest' | 'test'): ScriptRef[] {
  const code = (ev: PmEvent[] | undefined) =>
    (ev ?? [])
      .filter((e) => e.listen === event && !e.disabled)
      .map((e) => (Array.isArray(e.script?.exec) ? e.script.exec.join('\n') : String(e.script?.exec ?? '')))
      .join('\n')
      .trim()
  const out: ScriptRef[] = []
  if (input.collectionId) {
    const c = repo.getCollectionMeta(input.collectionId)
    const cc = code(c?.events)
    if (cc) out.push({ source: `Collection "${c!.name}"`, code: cc })
    const chain: { name: string; event?: PmEvent[] }[] = []
    let cur = input.itemId ? repo.parentOf(input.itemId) : null
    let guard = 0
    while (cur && guard++ < 100) {
      const f = repo.getFolder(cur)
      if (!f) break
      chain.unshift({ name: f.name, event: f.event })
      cur = repo.parentOf(cur)
    }
    for (const f of chain) {
      const fc = code(f.event)
      if (fc) out.push({ source: `Pasta "${f.name}"`, code: fc })
    }
  }
  const rc = code(input.doc.event)
  if (rc) out.push({ source: 'Requisição', code: rc })
  return out
}

function parseCookies(headers: [string, string][]) {
  return headers
    .filter(([k]) => k.toLowerCase() === 'set-cookie')
    .map(([, v]) => {
      const [pair, ...attrs] = v.split(';')
      const eq = pair.indexOf('=')
      const c: { name: string; value: string; domain?: string; path?: string } = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() }
      for (const a of attrs) {
        const [k, ...rest] = a.trim().split('=')
        if (k.toLowerCase() === 'domain') c.domain = rest.join('=')
        if (k.toLowerCase() === 'path') c.path = rest.join('=')
      }
      return c
    })
}

/**
 * Contexto de uma execução do Runner: as variáveis vivem aqui durante a execução (os scripts de uma
 * requisição enxergam o que os anteriores gravaram) e só vão para o banco no fim, se o usuário quiser.
 */
export interface RunContext {
  globals: KeyValue[]
  collectionVariables: KeyValue[]
  environment: KeyValue[] | null
  environmentName: string | null
  iterationData: KeyValue[]
  iteration: number
  iterationCount: number
}

export async function executeRequest(repo: Repo, input: SendInput, appVersion: string, ctx?: RunContext): Promise<SendResult> {
  const env = !ctx && input.environmentId ? repo.getEnvironment(input.environmentId) : null
  const state: ScriptState = {
    globals: ctx ? ctx.globals : repo.getGlobals(),
    collectionVariables: ctx ? ctx.collectionVariables : input.collectionId ? repo.getCollectionVariables(input.collectionId) : [],
    environment: ctx ? ctx.environment : env ? env.values.map((v) => ({ ...v })) : null,
    environmentName: ctx ? ctx.environmentName : (env?.name ?? null),
    iterationData: ctx ? ctx.iterationData : [],
    local: [],
    request: {
      id: input.itemId,
      name: input.doc.name,
      method: input.doc.request.method,
      url: input.doc.request.url.raw,
      headers: input.doc.request.header.map((h) => ({ ...h })),
      body: JSON.parse(JSON.stringify(input.doc.request.body ?? { mode: 'none' })),
      auth: input.doc.request.auth
    }
  }
  const settingsForScripts = repo.getSettings()
  const scriptTimeout = settingsForScripts.scriptTimeoutMs
  const report: ScriptsReport = { tests: [], logs: [], errors: [], updated: {}, skipped: false, nextRequest: undefined }
  const changed: Record<string, boolean> = {}

  const runAll = async (event: 'prerequest' | 'test', scripts: ScriptRef[]): Promise<boolean> => {
    for (const s of scripts) {
      const r = await runInSandbox(
        {
          script: s.code,
          timeoutMs: scriptTimeout,
          httpSettings: settingsForScripts,
          state,
          info: {
            eventName: event,
            iteration: ctx?.iteration ?? 0,
            iterationCount: ctx?.iterationCount ?? 1,
            requestName: input.doc.name,
            requestId: input.itemId,
            location: [s.source]
          }
        },
        appVersion
      )
      report.tests.push(...r.tests.map((t) => ({ ...t, source: s.source })))
      report.logs.push(...r.logs.map((l) => ({ ...l, source: s.source, event })))
      for (const n of r.network ?? [])
        report.logs.push({
          level: n.error ? 'error' : 'info',
          text: `pm.sendRequest ${n.method} ${n.url} → ${n.error ?? n.status} (${n.ms} ms)`,
          source: s.source,
          event
        })
      if (r.state) {
        state.globals = r.state.globals
        state.collectionVariables = r.state.collectionVariables
        state.environment = r.state.environment
        if (ctx) {
          ctx.globals = state.globals
          ctx.collectionVariables = state.collectionVariables
          ctx.environment = state.environment
        }
        state.local = r.state.local
        state.request = r.state.request
        Object.assign(changed, r.state.changed)
      }
      if (r.nextRequest !== undefined) report.nextRequest = r.nextRequest
      if (r.skip) report.skipped = true
      if (r.error) {
        report.errors.push({ source: s.source, event, error: r.error })
        return false
      }
    }
    return true
  }

  // ---------- pre-request ----------
  const pre = collectScripts(repo, input, 'prerequest')
  const preOk = pre.length ? await runAll('prerequest', pre) : true
  if (!preOk || report.skipped) {
    if (!ctx) persist(repo, input, state, changed, report)
    const e = report.errors[0]
    return {
      ok: false,
      requestId: input.requestId,
      cancelled: false,
      code: e ? 'SCRIPT_ERROR' : 'SKIPPED',
      error: e ? `Erro no pre-request script (${e.source}): ${e.error}` : 'Requisição pulada por pm.execution.skipRequest()',
      request: null,
      scripts: report,
      skipped: !e
    }
  }

  // requisição depois dos scripts
  const doc: RequestDoc = {
    ...input.doc,
    request: {
      ...input.doc.request,
      method: state.request.method as RequestDoc['request']['method'],
      url: { ...input.doc.request.url, raw: state.request.url },
      header: state.request.headers,
      body: state.request.body
    }
  }

  // ---------- variáveis e auth ----------
  const scopes: Scope[] = [
    { name: 'global', values: state.globals },
    { name: 'collection', values: state.collectionVariables },
    { name: 'data', values: state.iterationData },
    { name: 'local', values: state.local }
  ]
  if (state.environment) scopes.push({ name: 'environment', values: state.environment })
  const lookup = makeLookup(scopes)
  let auth: PmAuth | undefined = doc.request.auth
  if (!auth && input.collectionId) auth = repo.inheritedAuth(input.collectionId, input.itemId ? repo.parentOf(input.itemId) : null).auth ?? undefined
  if (auth?.type === 'noauth') auth = undefined
  auth = resolveAuth(auth, lookup)
  let refreshed = null
  if (auth?.type === 'oauth2') {
    try {
      const r = await maybeRefresh(repo, auth, appVersion)
      auth = r.auth
      refreshed = r.refreshed
    } catch (e) {
      // falha na renovação vira erro desta requisição (antes subia como exceção: a aba ficava
      // carregando e, no Runner, a execução inteira parava)
      if (!ctx) persist(repo, input, state, changed, report)
      return {
        ok: false,
        requestId: input.requestId,
        cancelled: false,
        code: 'OAUTH2_REFRESH',
        error: `Não deu para renovar o token OAuth 2.0: ${(e as Error).message}. Peça um token novo em Authorization → Get New Access Token`,
        request: null,
        ...(pre.length || report.logs.length || report.tests.length ? { scripts: report } : {})
      }
    }
  }

  const settings = repo.getSettings()
  const jar = new CookieJar(repo.listCookies())
  const result = await send({ ...input, doc: resolveDoc(doc, lookup), auth }, appVersion, { settings, cookieJar: jar })
  if (jar.dirty) repo.applyCookieChanges(jar.changes)
  if (refreshed && result.ok) result.response.refreshedToken = refreshed

  // ---------- post-response ----------
  if (result.ok) {
    const tests = collectScripts(repo, input, 'test')
    if (tests.length) {
      const res = result.response
      state.response = {
        code: res.status,
        status: res.statusText,
        headers: res.headers,
        body: Buffer.from(res.body).toString('utf8'),
        responseTime: Math.round(res.timings.total),
        responseSize: res.headersSize + res.bodySize
      }
      state.cookies = parseCookies(res.headers)
      await runAll('test', tests)
    }
  }
  if (!ctx) persist(repo, input, state, changed, report)
  if (pre.length || report.tests.length || report.logs.length || report.errors.length) {
    if (result.ok) result.response.scripts = report
    else result.scripts = report
  }
  return result
}

/** Grava os escopos que os scripts mudaram (como o "current value" do Postman). */
function persist(repo: Repo, input: SendInput, state: ScriptState, changed: Record<string, boolean>, report: ScriptsReport) {
  if (changed.globals) {
    repo.setGlobals(clean(state.globals))
    report.updated.globals = clean(state.globals)
  }
  if (changed.environment && input.environmentId && state.environment) {
    const e = repo.updateEnvironment(input.environmentId, { values: clean(state.environment) })
    report.updated.environment = { id: e.id, values: e.values }
  }
  if (changed.collectionVariables && input.collectionId) {
    repo.setCollectionVariables(input.collectionId, clean(state.collectionVariables))
    report.updated.collection = { id: input.collectionId, values: clean(state.collectionVariables) }
  }
}

/** Só os campos do formato do Postman (sem undefined nem marcas internas). */
export const clean = (l: KeyValue[]) => l.map(({ key, value, type, disabled, description }) => ({ key, value, ...(type ? { type } : {}), ...(disabled ? { disabled } : {}), ...(description ? { description } : {}) }))

/**
 * OAuth 2.0 no envio: se o auth aponta para um token guardado (jp_tokenId), usa o token atual dele e,
 * com "Auto-refresh" ligado, renova antes de vencer (30 s de folga) quando há refresh_token.
 */
export async function maybeRefresh(repo: Repo, auth: PmAuth, appVersion = '0.0.0') {
  const id = getParam(auth, 'jp_tokenId')
  if (!id) return { auth, refreshed: null }
  let t = repo.getToken(id)
  if (!t) return { auth, refreshed: null }
  let refreshed = null
  if (getBool(auth, 'jp_autoRefresh', true) && t.refreshToken && t.expiresAt && t.expiresAt < Date.now() + 30_000) {
    t = repo.saveToken(await refreshToken(t, configFrom((k, d = '') => getParam(auth, k, d)), { settings: repo.getSettings(), appVersion }))
    refreshed = t
  }
  const list = (auth.oauth2 as { key: string; value: unknown }[]).map((p) => (p.key === 'accessToken' ? { ...p, value: t!.accessToken } : p))
  return { auth: { ...auth, oauth2: list }, refreshed }
}
