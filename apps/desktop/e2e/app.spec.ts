import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { JeffPostmanBridge } from '../src/shared/types'

// o page.evaluate roda na janela do app, onde o preload expõe window.jeffPostman
declare const window: { jeffPostman: JeffPostmanBridge }
declare const location: { href: string }

let app: ElectronApplication
let page: Page
let dataDir: string
let server: http.Server
let base: string

/** PDF mínimo e válido de uma página (com xref certo), para o visualizador abrir */
function tinyPdf(): Buffer {
  const NL = String.fromCharCode(10)
  const objs: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  const stream = 'BT /F1 24 Tf 40 100 Td (DANFE E2E) Tj ET'
  objs[3] = ['<< /Length ' + stream.length + ' >>', 'stream', stream, 'endstream'].join(NL)
  let out = '%PDF-1.4' + NL
  const offs: number[] = []
  objs.forEach((o, i) => {
    offs.push(out.length)
    out += [`${i + 1} 0 obj`, o, 'endobj', ''].join(NL)
  })
  const xref = out.length
  out += ['xref', `0 ${objs.length + 1}`, '0000000000 65535 f ', ...offs.map((o) => `${String(o).padStart(10, '0')} 00000 n `), ''].join(NL)
  out += ['trailer', `<< /Size ${objs.length + 1} /Root 1 0 R >>`, 'startxref', String(xref), '%%EOF', ''].join(NL)
  return Buffer.from(out, 'latin1')
}
// PNG 2×1 (um pixel vermelho e um azul)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAGAAGXTsgpAAAAAElFTkSuQmCC', 'base64')

test.beforeAll(async () => {
  // servidor de eco local: devolve método, caminho, headers e corpo
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (req.url?.startsWith('/arquivo.pdf')) {
        // octet-stream de propósito: o app tem de reconhecer o PDF pelos bytes
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="danfe-e2e.pdf"' })
        return res.end(tinyPdf())
      }
      if (req.url?.startsWith('/imagem')) {
        res.writeHead(200, { 'Content-Type': 'image/png' })
        return res.end(PNG)
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'sessao=e2e; Path=/' })
      res.end(JSON.stringify({ method: req.method, path: req.url, headers: req.headers, body }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  dataDir = mkdtempSync(join(tmpdir(), 'jeff-postman-e2e-'))
  app = await electron.launch({ args: ['.'], cwd: join(__dirname, '..'), env: { ...process.env, JEFF_POSTMAN_USER_DATA: dataDir, JEFF_POSTMAN_E2E: '1' } })
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
        event: [
          { listen: 'prerequest', script: { exec: ['console.log("antes-dois")'] } },
          { listen: 'test', script: { exec: ['pm.test("caminho", () => pm.expect(pm.response.json().path).to.equal("/dois"))', 'console.warn("depois-dois", pm.info.iteration)'] } }
        ],
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

  // clicar na requisição abre a requisição e a resposta à direita
  await page.locator('.run-row', { hasText: 'Dois' }).first().click()
  const side = page.locator('.run-side')
  await expect(side.locator('.rdp-status')).toContainText('200 OK')
  await expect(side.locator('.code-editor')).toContainText('/dois')
  await side.locator('.rdp-tab', { hasText: 'Request' }).click()
  await side.locator('.seg', { hasText: 'Headers' }).click()
  await expect(side.locator('.rdp-headers')).toContainText('User-Agent')
  await side.locator('.rdp-tab', { hasText: 'Tests' }).click()
  await expect(side.locator('.tr-row')).toContainText('caminho')
  // Console do detalhe: só os logs desta requisição
  await side.locator('.rdp-tab', { hasText: 'Console (2)' }).click()
  await expect(side.locator('.console-line.lv-log')).toContainText('antes-dois')
  await expect(side.locator('.console-line.lv-warn')).toContainText('depois-dois 0')
  await expect(side.locator('.console-line.req')).toContainText('/dois')
  // trocar de linha mantém a aba Console aberta
  await page.locator('.run-row', { hasText: 'Um' }).nth(1).click()
  await expect(side.locator('.rdp-tab.active')).toContainText('Console')
  await expect(side.locator('.console-line.req')).toContainText('/um')
  await side.locator('.icon-btn[title="Fechar"]').click()
  await expect(side).toHaveCount(0)

  // aba Console da requisição normal: logs do último envio
  await page.locator('.tree .row', { hasText: 'Dois' }).click()
  await page.locator('.send').click()
  await expect(page.locator('.status')).toHaveText('200 OK')
  await page.locator('.res-tabs .subtab', { hasText: 'Console (2)' }).click()
  await expect(page.locator('.res-console .console-line.lv-log')).toHaveText(/antes-dois/)
  await expect(page.locator('.res-console .console-line.lv-warn')).toHaveText(/depois-dois 0/)

  // Raw escolhido continua Raw no envio seguinte
  await page.locator('.res-tabs .subtab', { hasText: 'Body' }).click()
  await page.locator('.res-toolbar .seg', { hasText: 'Raw' }).click()
  await page.locator('.send').click()
  await expect(page.locator('.status')).toHaveText('200 OK')
  await expect(page.locator('.res-toolbar .seg.active')).toHaveText('Raw')
})

test('envio com erro mostra o console do envio abaixo do erro', async () => {
  await page.locator('.tab-add').click()
  await urlInput().fill('http://127.0.0.1:1/fora')
  await page.locator('.send').click()
  await expect(page.locator('.response-error')).toBeVisible()
  await expect(page.locator('.inline-console .console-line.req')).toContainText('127.0.0.1:1/fora')
  await expect(page.locator('.inline-console .console-empty')).toContainText('Nenhum console.log')
})

test('Runner: Pause segura a execução e Resume continua', async () => {
  await page.locator('.tab', { hasText: 'Runner' }).click()
  await page.locator('.btn', { hasText: 'New Run' }).click()
  const nums = page.locator('.rc-field input[type=number]')
  await nums.nth(0).fill('30')
  await nums.nth(1).fill('150')
  await page.locator('.run-btn').click()
  await expect(page.locator('.run-card', { hasText: 'Executadas' })).not.toContainText(/^Executadas0$/)
  await page.locator('.btn', { hasText: 'Pause' }).click()
  await expect(page.locator('.run-status')).toHaveText('Pausada')
  // a requisição em andamento pode terminar; depois disso nada mais sai
  await page.waitForTimeout(400)
  const parado = await page.locator('.run-card', { hasText: 'Executadas' }).locator('b').textContent()
  await page.waitForTimeout(800)
  await expect(page.locator('.run-card', { hasText: 'Executadas' }).locator('b')).toHaveText(parado!)
  await page.locator('.btn', { hasText: 'Resume' }).click()
  await expect(page.locator('.run-status')).toHaveText('Rodando…')
  await expect(page.locator('.run-card', { hasText: 'Executadas' }).locator('b')).not.toHaveText(parado!, { timeout: 5_000 })
  await page.locator('.btn', { hasText: 'Stop' }).click()
  await expect(page.locator('.run-status')).toHaveText('Parada', { timeout: 5_000 })
})

test('a barra lateral muda de largura arrastando a borda', async () => {
  const sidebar = page.locator('.sidebar')
  const w0 = (await sidebar.boundingBox())!.width
  const h = (await page.locator('.sidebar-resizer').boundingBox())!
  await page.mouse.move(h.x + h.width / 2, h.y + 200)
  await page.mouse.down()
  await page.mouse.move(h.x + h.width / 2 + 150, h.y + 200, { steps: 5 })
  await page.mouse.up()
  expect(Math.round((await sidebar.boundingBox())!.width)).toBe(Math.round(w0 + 150))
  await page.locator('.sidebar-resizer').dblclick()
  expect(Math.round((await sidebar.boundingBox())!.width)).toBe(330)
})

test('PDF e imagem aparecem formatados, não como texto', async () => {
  await page.locator('.tab-add').click()
  await urlInput().fill(`${base}/arquivo.pdf`)
  await page.locator('.send').click()
  await expect(page.locator('.status')).toHaveText('200 OK')
  await expect(page.locator('.res-body .lang-tag')).toHaveText('PDF')
  const pdf = page.locator('iframe.pdf-preview')
  await expect(pdf).toBeVisible()
  // o visualizador do Chromium carregou (o quadro tem conteúdo do tipo PDF)
  await expect.poll(async () => (await pdf.elementHandle())?.contentFrame().then((f) => f?.url() ?? ''), { timeout: 10_000 }).toMatch(/^blob:/)
  await page.locator('.res-toolbar .seg', { hasText: 'Raw' }).click()
  await expect(page.locator('.binary-note')).toContainText('application/pdf')
  await expect(page.locator('.code-editor')).toHaveCount(0)

  await urlInput().fill(`${base}/imagem`)
  await page.locator('.send').click()
  await expect(page.locator('.img-preview img')).toBeVisible()
  await expect(page.locator('.res-body .lang-tag')).toHaveText('Image · 2×1')
})

test('muitas abas: barra rola, setas e lista de abas abertas', async () => {
  for (let i = 0; i < 18; i++) await page.locator('.tab-add').click()
  const tabs = page.locator('.tabs')
  await expect(page.locator('.tab-scroll').first()).toBeVisible()
  // a aba ativa (a última criada) fica à vista
  const visible = async (loc: ReturnType<typeof page.locator>) => {
    const t = (await tabs.boundingBox())!
    const b = (await loc.boundingBox())!
    return b.x >= t.x - 1 && b.x + b.width <= t.x + t.width + 1
  }
  expect(await visible(page.locator('.tab.active'))).toBe(true)
  // a lista leva para a primeira aba e ela entra na tela
  await page.locator('.tab-list-btn').click()
  await page.locator('.menu.tab-list button').first().click()
  await expect(page.locator('.tab').first()).toHaveClass(/active/)
  await expect.poll(() => visible(page.locator('.tab').first())).toBe(true)
  // a roda do mouse anda pelas abas
  const before = await tabs.evaluate((el) => el.scrollLeft)
  await tabs.hover()
  await page.mouse.wheel(0, 600)
  await expect.poll(() => tabs.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before)
  // fecha as abas extras
  for (let i = 0; i < 18; i++) await page.keyboard.press('Control+w')
})

test('aba destacada em janela própria: sincroniza, foca e volta com alteração', async () => {
  // destaca a requisição "Dois" (da collection do Runner) com uma alteração não salva
  await page.locator('.tree .row', { hasText: 'Dois' }).click()
  const tab = page.locator('.tab.active')
  await expect(tab).toContainText('Dois')
  await urlInput().fill(`${base}/dois?alterada=1`)
  await expect(tab.locator('.dirty-dot')).toBeVisible()
  const opened = app.waitForEvent('window')
  await tab.click({ button: 'right' })
  await page.locator('.tab-menu button', { hasText: 'Abrir em janela separada' }).click()
  const win = await opened
  await win.waitForSelector('.detached-header')
  await expect(win.locator('.tab.active')).toContainText('Dois')
  await expect(win.locator('.url-bar .var-input input')).toHaveValue(`${base}/dois?alterada=1`)
  await expect(page.locator('.tab', { hasText: 'Dois' })).toHaveCount(0)
  // envia na janela destacada; o console da resposta é dela
  await win.locator('.send').click()
  await expect(win.locator('.status')).toHaveText('200 OK')
  await win.waitForTimeout(500)
  await win.screenshot({ path: 'C:/Users/jeffe/AppData/Local/Temp/claude/5f781027a956e75a/41a26535-c175-459a-8c1c-24fe6457df28/scratchpad/detached.png' })
  // clicar na requisição na principal traz a janela destacada, sem abrir cópia
  await page.locator('.tree .row', { hasText: 'Dois' }).click()
  await page.waitForTimeout(300)
  await expect(page.locator('.tab', { hasText: 'Dois' })).toHaveCount(0)
  // trocar o environment numa janela troca na outra
  await win.locator('.env-selector select').selectOption({ label: 'E2E' })
  await expect(page.locator('.env-selector select')).toHaveValue(await win.locator('.env-selector select').inputValue())
  await win.locator('.env-selector select').selectOption({ label: 'No environment' })
  // fechar a janela (X) devolve a aba para a principal, com a alteração e a resposta
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#detached'))?.close()
  })
  await win.waitForEvent('close')
  const back = page.locator('.tab.active')
  await expect(back).toContainText('Dois')
  await expect(back.locator('.dirty-dot')).toBeVisible()
  await expect(urlInput()).toHaveValue(`${base}/dois?alterada=1`)
  await expect(page.locator('.status')).toHaveText('200 OK')
})

test('janela destacada: várias abas, mover uma de volta e anexar o resto', async () => {
  await page.locator('.tab-add').click()
  await urlInput().fill(`${base}/primeira`)
  const opened = app.waitForEvent('window')
  await page.locator('.tab.active').click({ button: 'right' })
  await page.locator('.tab-menu button', { hasText: 'Abrir em janela separada' }).click()
  const win = await opened
  await win.waitForSelector('.detached-header')
  // abre outra aba na janela destacada
  await win.locator('.tab-add').click()
  await win.locator('.url-bar .var-input input').fill(`${base}/segunda`)
  await expect(win.locator('.tab')).toHaveCount(2)
  // "Mover para a janela principal" leva só aquela aba
  await win.locator('.tab.active').click({ button: 'right' })
  await win.locator('.tab-menu button', { hasText: 'Mover para a janela principal' }).click()
  await expect(win.locator('.tab')).toHaveCount(1)
  await expect(page.locator('.tab.active')).toContainText('/segunda')
  // buscar (Ctrl+K) na destacada uma requisição aberta na principal traz a principal, sem cópia
  await page.locator('.tree .row', { hasText: 'Um' }).click()
  await expect(page.locator('.tab.active')).toContainText('Um')
  await win.locator('.tab.active').click()
  await win.keyboard.press('Control+k')
  await win.locator('.palette-input input').fill('Um')
  await win.locator('.palette-row', { hasText: 'Um' }).first().click()
  await win.waitForTimeout(300)
  await expect(win.locator('.tab')).toHaveCount(1)
  await expect(win.locator('.tab', { hasText: 'Um' })).toHaveCount(0)
  // o botão Anexar devolve o resto e fecha a janela
  const closed = win.waitForEvent('close')
  await win.locator('.attach-btn').click()
  await closed
  await expect(page.locator('.tab.active')).toContainText('/primeira')
  // limpa as abas criadas
  for (let i = 0; i < 2; i++) await page.locator('.tab.active .tab-close').click()
})

test('fechar aba com alteração não salva pede confirmação', async () => {
  await page.locator('.tab-add').click()
  await urlInput().fill(`${base}/rascunho`)
  const tabs = page.locator('.tabbar .tab')
  const before = await tabs.count()
  // "Cancelar" mantém a aba aberta
  page.once('dialog', (d) => void d.dismiss())
  await page.keyboard.press('Control+w')
  await expect(tabs).toHaveCount(before)
  // "OK" fecha
  page.once('dialog', (d) => void d.accept())
  await page.keyboard.press('Control+w')
  await expect(tabs).toHaveCount(before - 1)
})

test('a janela não sai da tela do app (o preload não vai para outra página)', async () => {
  const appUrl = page.url()
  await page.evaluate((b) => (location.href = `${b}/fora`), base)
  await page.waitForTimeout(500)
  expect(page.url()).toBe(appUrl)
  expect(await page.evaluate(() => typeof window.jeffPostman)).toBe('object')
})
