import { app, BrowserWindow, safeStorage, shell } from 'electron'
import { dirname, join } from 'path'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { Repo } from './db'
import { registerIpc } from './ipc'

let repo: Repo | null = null

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
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // Links externos abrem no navegador do sistema, nunca dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
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
  registerIpc(repo, dbPath)
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
  if (existsSync(newPath)) return
  const old = join(app.getPath('appData'), 'Carteiro', 'carteiro.db')
  if (!existsSync(old)) return
  mkdirSync(dirname(newPath), { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(old + suffix)) copyFileSync(old + suffix, newPath + suffix)
  }
}
