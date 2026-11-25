import { describe, expect, it } from 'vitest'
import { runScript } from './run'
import type { ScriptInput, ScriptState } from '@shared/types'

const baseState = (over: Partial<ScriptState> = {}): ScriptState => ({
  globals: [{ key: 'g', value: 'global' }],
  collectionVariables: [{ key: 'c', value: 'colecao' }, { key: 'base', value: 'https://api.local' }],
  environment: [{ key: 'e', value: 'env' }, { key: 'token', value: 'abc' }],
  environmentName: 'Dev',
  iterationData: [],
  local: [],
  request: {
    id: 'r1',
    name: 'Listar',
    method: 'GET',
    url: '{{base}}/users?page=1',
    headers: [{ key: 'Accept', value: 'application/json' }],
    body: { mode: 'none' }
  },
  ...over
})

const response = {
  code: 200,
  status: 'OK',
  headers: [
    ['Content-Type', 'application/json'],
    ['X-Total', '2']
  ] as [string, string][],
  body: JSON.stringify({ data: [{ id: 1, name: 'Ana' }, { id: 2, name: 'Bruno' }], token: 'novo-token' }),
  responseTime: 120,
  responseSize: 300
}

function run(script: string, ev: 'prerequest' | 'test' = 'test', over: Partial<ScriptState> = {}, extra: Partial<ScriptInput> = {}) {
  const state = baseState(over)
  if (ev === 'test') state.response = response
  return runScript(
    { script, state, info: { eventName: ev, iteration: 0, iterationCount: 1, requestName: 'Listar', requestId: 'r1' }, ...extra },
    {
      sendRequest: async (req) =>
        req.url.includes('falha')
          ? { error: 'Could not resolve host' }
          : { response: { code: 201, status: 'Created', headers: [['A', '1']], body: JSON.stringify({ eco: req.method, url: req.url }), responseTime: 5 } }
    }
  )
}

describe('pm.test e asserções (scripts típicos do Postman)', () => {
  it('snippets padrão passam e falham como no Postman', async () => {
    const r = await run(`
      pm.test("Status code is 200", function () { pm.response.to.have.status(200) })
      pm.test("Body matches string", function () { pm.expect(pm.response.text()).to.include("Ana") })
      pm.test("Your test name", function () { var jsonData = pm.response.json(); pm.expect(jsonData.data[0].name).to.eql("Ana") })
      pm.test("Content-Type is present", function () { pm.response.to.have.header("Content-Type") })
      pm.test("Response time is less than 200ms", function () { pm.expect(pm.response.responseTime).to.be.below(200) })
      pm.test("Successful POST request", function () { pm.expect(pm.response.code).to.be.oneOf([201, 202]) })
      pm.test("Status OK", () => pm.response.to.be.ok)
      pm.test("JSON tem 2 itens", () => pm.expect(pm.response.json().data).to.have.lengthOf(2))
      pm.test.skip("pulado", () => {})
    `)
    expect(r.error).toBeNull()
    expect(r.tests.map((t) => [t.name, t.passed, t.skipped])).toEqual([
      ['Status code is 200', true, false],
      ['Body matches string', true, false],
      ['Your test name', true, false],
      ['Content-Type is present', true, false],
      ['Response time is less than 200ms', true, false],
      ['Successful POST request', false, false],
      ['Status OK', true, false],
      ['JSON tem 2 itens', true, false],
      ['pulado', false, true]
    ])
    expect(r.tests[5].error).toBe('AssertionError: expected 200 to be one of [ 201, 202 ]')
  })

  it('to.have.jsonBody, jsonSchema, not, header com valor e body', async () => {
    const r = await run(`
      pm.test("a", () => pm.response.to.have.jsonBody("data"))
      pm.test("b", () => pm.response.to.have.jsonSchema({ type: "object", required: ["data"], properties: { data: { type: "array" } } }))
      pm.test("c", () => pm.response.to.not.have.status(404))
      pm.test("d", () => pm.response.to.have.header("X-Total", "2"))
      pm.test("e", () => pm.response.to.be.json)
      pm.test("f falha", () => pm.response.to.have.jsonSchema({ type: "object", required: ["inexistente"] }))
    `)
    expect(r.tests.map((t) => t.passed)).toEqual([true, true, true, true, true, false])
    expect(r.tests[5].error).toMatch(/schema/)
  })

  it('teste assíncrono e legado tests[]', async () => {
    const r = await run(`
      pm.test("async", async () => { await new Promise(r => setTimeout(r, 20)); pm.expect(1).to.equal(1) })
      pm.test("done", (done) => { setTimeout(() => { pm.expect(2).to.equal(3); done() }, 10) })
      tests["legado ok"] = responseCode.code === 200
      tests["legado falha"] = responseBody.length === 0
    `)
    expect(r.error).toBeNull()
    expect(r.tests.map((t) => [t.name, t.passed])).toEqual([
      ['async', true],
      ['done', false],
      ['legado ok', true],
      ['legado falha', false]
    ])
  })
})

describe('variáveis', () => {
  it('get com precedência, set em cada escopo, unset e replaceIn', async () => {
    const r = await run(
      `
      pm.environment.set("token", pm.response.json().token)
      pm.globals.set("contador", 1)
      pm.collectionVariables.set("ultimo", "Ana")
      pm.collectionVariables.unset("c")
      pm.variables.set("so_local", "x")
      console.log(pm.variables.get("e"), pm.variables.get("g"), pm.variables.replaceIn("{{base}}/u/{{so_local}}"), pm.environment.name)
      console.log(typeof pm.variables.replaceIn("{{$guid}}"), pm.variables.get("nada"))
    `
    )
    expect(r.error).toBeNull()
    expect(r.logs.map((l) => l.text)).toEqual(['env global https://api.local/u/x Dev', 'string undefined'])
    expect(r.state!.environment).toContainEqual({ key: 'token', value: 'novo-token' })
    expect(r.state!.globals).toContainEqual({ key: 'contador', value: '1' })
    expect(r.state!.collectionVariables).toEqual([{ key: 'base', value: 'https://api.local' }, { key: 'ultimo', value: 'Ana' }])
    expect(r.state!.local).toEqual([{ key: 'so_local', value: 'x' }])
    expect(r.state!.changed).toEqual({ environment: true, globals: true, collectionVariables: true, local: true })
  })
  it('sem environment ativo, set só avisa', async () => {
    const r = await run(`pm.environment.set("a", 1); pm.test("ok", () => {})`, 'test', { environment: null, environmentName: null })
    expect(r.error).toBeNull()
    expect(r.logs[0].level).toBe('warn')
  })
})

describe('pre-request: mexer na requisição', () => {
  it('headers, URL, query, método e corpo', async () => {
    const r = await run(
      `
      pm.request.headers.add({ key: "X-Req-Id", value: "123" })
      pm.request.headers.upsert({ key: "accept", value: "text/plain" })
      pm.request.url.query.add({ key: "q", value: "abc" })
      pm.request.url.query.remove("page")
      pm.request.method = "post"
      pm.request.body.update(JSON.stringify({ ts: 1 }))
      console.log(pm.request.url.getHost(), pm.request.url.getPath(), pm.request.headers.get("x-req-id"))
    `,
      'prerequest'
    )
    expect(r.error).toBeNull()
    expect(r.state!.request.headers).toEqual([
      { key: 'Accept', value: 'text/plain', disabled: false },
      { key: 'X-Req-Id', value: '123', disabled: false }
    ])
    expect(r.state!.request.url).toBe('{{base}}/users?q=abc')
    expect(r.state!.request.method).toBe('POST')
    expect(r.state!.request.body).toEqual({ mode: 'raw', raw: '{"ts":1}' })
    expect(r.logs[0].text).toBe('api.local /users 123')
  })
  it('trocar a URL inteira, skipRequest e setNextRequest', async () => {
    const r = await run(`pm.request.url = "https://outro.local/x"; pm.execution.skipRequest(); pm.execution.setNextRequest("Criar")`, 'prerequest')
    expect(r.state!.request.url).toBe('https://outro.local/x')
    expect(r.skip).toBe(true)
    expect(r.nextRequest).toBe('Criar')
  })
})

describe('pm.sendRequest, timers e bibliotecas', () => {
  it('callback e await', async () => {
    const r = await run(`
      pm.sendRequest({ url: "https://api.local/login", method: "POST", header: { "Content-Type": "application/json" }, body: { mode: "raw", raw: "{}" } }, (err, res) => {
        pm.environment.set("cb", res.json().eco)
      })
      const res = await pm.sendRequest("https://api.local/ping")
      pm.test("await", () => pm.expect(res.code).to.equal(201))
      try { await pm.sendRequest("https://falha.local") } catch (e) { console.log("erro:", e.message) }
    `)
    expect(r.error).toBeNull()
    expect(r.tests[0].passed).toBe(true)
    expect(r.state!.environment).toContainEqual({ key: 'cb', value: 'POST' })
    expect(r.logs[0].text).toBe('erro: Could not resolve host')
  })
  it('lodash, moment, crypto-js, uuid, atob/btoa e require desconhecido', async () => {
    const r = await run(`
      const _l = require('lodash'); const moment = require('moment'); const CryptoJS = require('crypto-js')
      console.log(_l.sum([1,2,3]), _.chunk([1,2,3,4], 2).length, moment("2026-11-24").format("DD/MM/YYYY"))
      console.log(CryptoJS.HmacSHA256("msg", "key").toString(CryptoJS.enc.Base64), btoa("ana:1"), atob("YW5hOjE="))
      console.log(require('uuid').v4().length)
      try { require('fs') } catch (e) { console.log(e.message.split('.')[0]) }
    `)
    expect(r.error).toBeNull()
    expect(r.logs.map((l) => l.text)).toEqual([
      '6 2 24/11/2026',
      'LZPLwb4We8sWN6SiPL/wGnh48MUO6DOVTqUiG7G4xig= YW5hOjE= ana:1',
      '36',
      'Módulo "fs" não está disponível'
    ])
  })
})

describe('erros e limites', () => {
  it('erro no script é reportado e os testes anteriores ficam', async () => {
    const r = await run(`pm.test("antes", () => {}); naoExiste(); pm.test("depois", () => {})`)
    expect(r.error).toBe('ReferenceError: naoExiste is not defined')
    expect(r.tests.map((t) => t.name)).toEqual(['antes'])
  })
  it('laço infinito é interrompido', async () => {
    const t0 = Date.now()
    const r = await run(`while (true) {}`, 'test', {}, { timeoutMs: 300 })
    expect(r.error).toMatch(/tempo limite/)
    expect(Date.now() - t0).toBeLessThan(3000)
  })
  it('laço infinito dentro de callback de timer também', async () => {
    const r = await run(`setTimeout(() => { while (true) {} }, 1)`, 'test', {}, { timeoutMs: 300 })
    expect(r.error).toMatch(/tempo limite/)
  })
  it('promessa que nunca termina respeita o prazo', async () => {
    const r = await run(`await new Promise(() => {})`, 'test', {}, { deadlineMs: 300 })
    expect(r.error).toMatch(/não terminou/)
  })
})

describe('isolamento (não alcança o Node)', () => {
  const attempts = [
    'this.constructor.constructor("return typeof process")()',
    'pm.test.constructor("return typeof process")()',
    'pm.expect.constructor("return typeof process")()',
    'console.log.constructor("return typeof process")()',
    'require.constructor("return typeof process")()',
    '(() => {}).constructor("return typeof process")()',
    'Object.getPrototypeOf(pm).constructor.constructor("return typeof process")()',
    'typeof __host',
    'typeof globalThis.process',
    'typeof Buffer',
    'typeof module'
  ]
  it.each(attempts)('%s', async (code) => {
    const r = await run(`console.log(${code})`)
    expect(r.error).toBeNull()
    expect(r.logs[0].text).toBe('undefined')
  })
  it('erro vindo de pm.sendRequest não dá acesso ao Node', async () => {
    const r = await run(`try { await pm.sendRequest("https://falha.local") } catch (e) { console.log(e.constructor.constructor("return typeof process")()) }`)
    expect(r.logs[0].text).toBe('undefined')
  })
})
