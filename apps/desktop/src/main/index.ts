import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron'
import { dirname, join } from 'path'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { pathToFileURL } from 'url'
import { Repo } from './db'
import { registerIpc } from './ipc'

/** Endereço da tela do app (o servidor do Vite em desenvolvimento, o index.html empacotado no build). */
function isAppUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (dev) return u.origin === new URL(dev).origin
    const page = pathToFileURL(join(__dirname, '../renderer/index.html')).pathname
    return u.protocol === 'file:' && decodeURIComponent(u.pathname).toLowerCase() === decodeURIComponent(page).toLowerCase()
  } catch {
    return false
  }
}

let repo: Repo | null = null

// testes (E2E e manuais) rodam com uma pasta de dados própria, sem tocar no banco do usuário
if (process.env.JEFF_POSTMAN_USER_DATA) app.setPath('userData', process.env.JEFF_POSTMAN_USER_DATA)

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#1e1e1e',
    title: 'JEFF Postman',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1e1e1e', symbolColor: '#c8c8c8', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // visualizador de PDF embutido do Chromium (Preview de resposta em PDF)
      plugins: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // Links externos abrem no navegador do sistema, nunca dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // A janela nunca sai da tela do app: soltar um arquivo fora da área de import, um link ou um
  // redirect levariam a outra página, que receberia o preload (e com ele o IPC inteiro).
  win.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault()
  })
  win.webContents.on('will-attach-webview', (e) => e.preventDefault())
  // Alterações não salvas: a tela pede para segurar o fechamento; aqui o usuário decide
  win.webContents.on('will-prevent-unload', (e) => {
    // nos testes de ponta a ponta não há quem responda a caixa: fecha direto
    if (process.env.JEFF_POSTMAN_E2E) return e.preventDefault()
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Sair sem salvar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'JEFF Postman',
      message: 'Há abas com alterações não salvas.',
      detail: 'Se sair agora, essas alterações se perdem.'
    })
    if (choice === 0) e.preventDefault()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const dbPath = join(app.getPath('userData'), 'jeff-postman.db')
  migrateFromCarteiro(dbPath)
  repo = new Repo(dbPath)
  if (safeStorage.isEncryptionAvailable()) {
    repo.crypt = {
      enc: (s) => safeStorage.encryptString(s),
      dec: (b) => safeStorage.decryptString(Buffer.from(b))
    }
  }
  registerIpc(repo, dbPath, isAppUrl)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  repo?.close()
  repo = null
  if (process.platform !== 'darwin') app.quit()
})

/**
 * O app se chamava "Carteiro" até 24/11/2026. Na primeira abertura com o nome novo, copia o banco
 * antigo (%APPDATA%\Carteiro\carteiro.db, com -wal e -shm). A pasta antiga fica como cópia de segurança.
 */
function migrateFromCarteiro(newPath: string): void {
  if (process.env.JEFF_POSTMAN_USER_DATA || existsSync(newPath)) return
  const old = join(app.getPath('appData'), 'Carteiro', 'carteiro.db')
  if (!existsSync(old)) return
  mkdirSync(dirname(newPath), { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(old + suffix)) copyFileSync(old + suffix, newPath + suffix)
  }
}
