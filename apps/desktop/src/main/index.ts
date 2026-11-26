import { app, BrowserWindow, safeStorage } from 'electron'
import { dirname, join } from 'path'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { pathToFileURL } from 'url'
import { Repo } from './db'
import { registerIpc } from './ipc'
import { createAppWindow, registerWindowIpc } from './windows'

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
  registerWindowIpc(isAppUrl)
  createAppWindow('main', isAppUrl)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createAppWindow('main', isAppUrl)
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
