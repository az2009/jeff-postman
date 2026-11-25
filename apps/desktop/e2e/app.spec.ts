import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { JeffPostmanBridge } from '../src/shared/types'

// o page.evaluate roda na janela do app, onde o preload expõe window.jeffPostman
declare const window: { jeffPostman: JeffPostmanBridge }

let app: ElectronApplication
let page: Page
let dataDir: string
let server: http.Server
let base: string

test.beforeAll(async () => {
  // servidor de eco local: devolve método, caminho, headers e corpo
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'sessao=e2e; Path=/' })
      res.end(JSON.stringify({ method: req.method, path: req.url, headers: req.headers, body }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  dataDir = mkdtempSync(join(tmpdir(), 'jeff-postman-e2e-'))
  app = await electron.launch({ args: ['.'], cwd: join(__dirname, '..'), env: { ...process.env, JEFF_POSTMAN_USER_DATA: dataDir } })
  page = await app.firstWindow()
  await page.waitForSelector('.tabbar')
})

test.afterAll(async () => {
  await app?.close()
  server?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

const urlInput = () => page.locator('.url-bar .var-input input')

test('cria collection e requisição pela tela, envia e salva', async () => {
  await page.getByRole('button', { name: 'Create Collection' }).click()
  const col = page.locator('.tree .row', { hasText: 'New Collection' })
  await col.click({ button: 'right' })
  await page.locator('.menu.floating button', { hasText: 'Add request' }).click()
  await urlInput().fill(`${base}/echo?x=1`)
  await page.locator('.send').click()
  await expect(page.locator('.status')).toHaveText('200 OK')
  await expect(page.locator('.res-tabs .subtab', { hasText: 'Headers' })).toBeVisible()
  await page.keyboard.press('Control+s')
  await expect(page.locator('.tab.active .dirty-dot')).toHaveCount(0)
  await expect(page.locator('.tree .row', { hasText: 'New Request' })).toBeVisible()
})

test('environment: variável resolvida no envio e destacada na URL', async () => {
  await page.evaluate(async (b) => {
    const c = window.jeffPostman
    const e = await c.invoke('environments:create', 'E2E')
    await c.invoke('environments:update', e.id, { values: [{ key: 'base', value: b }] })
  }, base)
  await page.reload()
  await page.waitForSelector('.tabbar')
  await page.locator('.env-selector select').selectOption({ label: 'E2E' })
  await page.locator('.tab-add').click()
  await urlInput().fill('{{base}}/vars?y={{nao_existe}}')
  await expect(page.locator('.url-bar .var-ok')).toHaveText('{{base}}')
  await expect(page.locator('.url-bar .var-bad')).toHaveText('{{nao_existe}}')
  await page.locator('.send').click()
  await expect(page.locator('.status')).toHaveText('200 OK')
  const path = await page.evaluate(async () => (await window.jeffPostman.invoke('history:list', 1))[0].url)
  expect(path).toBe('{{base}}/vars?y={{nao_existe}}')
})

test('importa cURL e mantém cookies entre requisições', async () => {
  await page.keyboard.press('Control+o')
  await page.locator('.import-text').fill(`curl '${base}/curl' -H 'X-Teste: 1' --data-raw '{"a":1}'`)
  await page.locator('.import-modal button', { hasText: 'Import' }).click()
  await expect(page.locator('.method-select')).toHaveValue('POST')
  await page.locator('.send').click()
  await expect(page.locator('.status')).toHaveText('200 OK')
  // a primeira resposta mandou Set-Cookie: a próxima requisição tem de levar o cookie
  await page.locator('.send').click()
  await expect(page.locator('.status')).toHaveText('200 OK')
  const cookies = await page.evaluate(async () => (await window.jeffPostman.invoke('cookies:list')).map((c) => `${c.name}=${c.value}`))
  expect(cookies).toContain('sessao=e2e')
})

test('Runner roda a collection importada com testes', async () => {
  const collection = {
    info: { name: 'E2E Runner', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [
      {
        name: 'Um',
        event: [{ listen: 'test', script: { exec: ['pm.test("200", () => pm.response.to.have.status(200))', 'pm.environment.set("ultimo", "um")'] } }],
        request: { method: 'GET', url: `${base}/um` }
      },
      {
        name: 'Dois',
        event: [{ listen: 'test', script: { exec: ['pm.test("caminho", () => pm.expect(pm.response.json().path).to.equal("/dois"))'] } }],
        request: { method: 'GET', url: `${base}/dois` }
      }
    ]
  }
  await page.keyboard.press('Control+o')
  await page.locator('.import-text').fill(JSON.stringify(collection))
  await page.locator('.import-modal button', { hasText: 'Import' }).click()
  await expect(page.locator('.import-row.ok')).toContainText('2 requisições')
  await page.locator('.import-modal button', { hasText: 'Close' }).click()
  await page.locator('.tree .row', { hasText: 'E2E Runner' }).click({ button: 'right' })
  await page.locator('.menu.floating button', { hasText: 'Run collection' }).click()
  await page.locator('.rc-field input[type=number]').first().fill('3')
  await page.locator('.run-btn').click()
  await expect(page.locator('.run-status')).toHaveText('Concluída', { timeout: 20_000 })
  await expect(page.locator('.run-card', { hasText: 'Executadas' })).toContainText('6')
  await expect(page.locator('.run-card', { hasText: 'Testes aprovados' })).toContainText('6')
  await expect(page.locator('.run-card', { hasText: 'Testes reprovados' })).toContainText('0')
})
