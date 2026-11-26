/**
 * Janelas do app: a principal e as destacadas (uma aba cada, como "Open in New Window" do IntelliJ).
 * Todas nascem aqui com as mesmas proteções. O main guarda a aba em trânsito, sabe qual requisição
 * está em qual janela destacada e avisa as outras janelas quando o banco muda.
 */
import { BrowserWindow, dialog, ipcMain, screen, shell, type IpcMainInvokeEvent, type Rectangle } from 'electron'
import { join } from 'path'
import type { DataChange, IpcChannel, IpcContract, ScreenPoint, TabSnapshot } from '@shared/types'

type Kind = 'main' | 'detached'

interface Detached {
  win: BrowserWindow
  /** aba esperando a janela pedir (window:claimTab) */
  pending: TabSnapshot | null
  itemIds: string[]
  /** já pode fechar sem devolver a aba (devolvida, ou não há janela principal) */
  released: boolean
}

let mainWindow: BrowserWindow | null = null
const detached = new Map<number, Detached>()

const DETACHED_SIZE = { width: 1100, height: 760 }

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/** Cria uma janela do app com as proteções de sempre; a destacada carrega a mesma tela com #detached. */
export function createAppWindow(kind: Kind, isAppUrl: (url: string) => boolean, bounds?: Partial<Rectangle>): BrowserWindow {
  const dark = !(BrowserWindow.getAllWindows()[0]?.getBackgroundColor() ?? '#1e1e1e').toLowerCase().startsWith('#ffffff')
  const win = new BrowserWindow({
    width: kind === 'main' ? 1440 : DETACHED_SIZE.width,
    height: kind === 'main' ? 900 : DETACHED_SIZE.height,
    ...bounds,
    minWidth: kind === 'main' ? 960 : 560,
    minHeight: kind === 'main' ? 600 : 400,
    show: false,
    backgroundColor: dark ? '#1e1e1e' : '#ffffff',
    title: 'JEFF Postman',
    titleBarStyle: 'hidden',
    titleBarOverlay: dark ? { color: '#1e1e1e', symbolColor: '#c8c8c8', height: 40 } : { color: '#ffffff', symbolColor: '#3a3a3a', height: 40 },
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
      message: kind === 'main' ? 'Há abas com alterações não salvas.' : 'Esta aba tem alterações não salvas.',
      detail: 'Se fechar agora, essas alterações se perdem.'
    })
    if (choice === 0) e.preventDefault()
  })

  const id = win.webContents.id
  if (kind === 'main') {
    mainWindow = win
    // sem a principal não há para onde devolver: as destacadas fecham (cada uma pergunta se tiver alteração)
    win.on('closed', () => {
      mainWindow = null
      for (const d of detached.values()) {
        d.released = true
        if (!d.win.isDestroyed()) d.win.close()
      }
    })
  } else {
    const entry: Detached = { win, pending: null, itemIds: [], released: false }
    detached.set(id, entry)
    // fechar a janela destacada (X) devolve as abas para a principal, como no IntelliJ
    win.on('close', (e) => {
      if (entry.released || !getMainWindow()) return
      e.preventDefault()
      win.webContents.send('window:requestAttach')
      // se a tela não responder, fecha do jeito normal (com a pergunta de alteração não salva)
      setTimeout(() => {
        if (!win.isDestroyed() && !entry.released) {
          entry.released = true
          win.close()
        }
      }, 4000)
    })
    win.on('closed', () => detached.delete(id))
  }

  const dev = process.env['ELECTRON_RENDERER_URL']
  const hash = kind === 'detached' ? 'detached' : undefined
  if (dev) win.loadURL(hash ? `${dev}#${hash}` : dev)
  else win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  return win
}

/** Janela nova perto de onde a aba foi solta, sem sair da área visível da tela. */
function boundsAt(point: ScreenPoint | null): Partial<Rectangle> {
  const p = point ?? screen.getCursorScreenPoint()
  const area = screen.getDisplayNearestPoint(p).workArea
  const width = Math.min(DETACHED_SIZE.width, area.width)
  const height = Math.min(DETACHED_SIZE.height, area.height)
  // o mouse fica sobre o cabeçalho da janela nova, como se a aba tivesse sido "puxada"
  const x = Math.round(Math.max(area.x, Math.min(p.x - 160, area.x + area.width - width)))
  const y = Math.round(Math.max(area.y, Math.min(p.y - 20, area.y + area.height - height)))
  return { x, y, width, height }
}

function contains(b: Rectangle, p: ScreenPoint): boolean {
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height
}

/** Manda abas para a janela principal, na posição de soltar (convertida para a tela da principal). */
function sendToMain(snapshots: TabSnapshot[], point: ScreenPoint | null): boolean {
  const main = getMainWindow()
  if (!main) return false
  const cb = main.getContentBounds()
  const client = point ? { clientX: point.x - cb.x, clientY: point.y - cb.y } : null
  if (snapshots.length) main.webContents.send('window:attachTab', { snapshots, ...client })
  if (main.isMinimized()) main.restore()
  main.focus()
  return true
}

type WindowChannel = Extract<IpcChannel, `window:${string}`>
type WindowHandlers = {
  [K in WindowChannel]: (event: IpcMainInvokeEvent, ...args: IpcContract[K]['args']) => IpcContract[K]['ret'] | Promise<IpcContract[K]['ret']>
}

export function registerWindowIpc(isAppUrl: (url: string) => boolean): void {
  const handlers: WindowHandlers = {
    'window:detach': (_e, snapshot, point) => {
      const win = createAppWindow('detached', isAppUrl, boundsAt(point))
      detached.get(win.webContents.id)!.pending = snapshot
    },
    'window:claimTab': (e) => {
      const d = detached.get(e.sender.id)
      if (!d) return null
      const s = d.pending
      d.pending = null
      return s
    },
    'window:attach': (e, snapshots) => {
      const d = detached.get(e.sender.id)
      if (!sendToMain(Array.isArray(snapshots) ? snapshots : [], null)) {
        // sem janela principal: fechar aqui é fechar de vez (a tela pergunta se houver alteração)
        if (d) d.released = true
        return false
      }
      if (d) {
        d.released = true
        // fecha depois de responder, para o invoke da tela não ficar sem resposta
        setImmediate(() => !d.win.isDestroyed() && d.win.close())
      }
      return true
    },
    'window:moveToMain': (_e, snapshot, point) => sendToMain([snapshot], point),
    'window:dragEnd': (e) => {
      const p = screen.getCursorScreenPoint()
      const self = BrowserWindow.fromWebContents(e.sender)
      if (self && contains(self.getBounds(), p)) return { over: 'self', ...p }
      const main = getMainWindow()
      if (main && main !== self && !main.isMinimized() && contains(main.getBounds(), p)) return { over: 'main', ...p }
      return { over: 'outside', ...p }
    },
    'window:setTabInfo': (e, info) => {
      const d = detached.get(e.sender.id)
      if (!d) return
      d.itemIds = Array.isArray(info.itemIds) ? info.itemIds.filter((x) => typeof x === 'string') : []
      d.win.setTitle(`${info.title} · JEFF Postman`)
    },
    'window:focusItem': (_e, itemId) => {
      for (const d of detached.values()) {
        if (d.itemIds.includes(itemId) && !d.win.isDestroyed()) {
          if (d.win.isMinimized()) d.win.restore()
          d.win.focus()
          return true
        }
      }
      return false
    }
  }
  for (const channel of Object.keys(handlers) as WindowChannel[]) {
    const fn = handlers[channel] as (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const url = event.senderFrame?.url ?? ''
      if (!isAppUrl(url)) throw new Error(`IPC recusado: origem não é a tela do app (${url || 'desconhecida'})`)
      return fn(event, ...args)
    })
  }
}

/** O que cada canal que grava no banco muda, para as outras janelas recarregarem. */
export function changesOf(channel: IpcChannel, args: unknown[]): DataChange[] {
  if (/^(collections|items):/.test(channel) && !/:(list|get|getAuth|getEvents|getFolder)$/.test(channel)) return [{ scope: 'collections' }]
  if (channel === 'import:text' || channel === 'import:pickFiles') return [{ scope: 'collections' }, { scope: 'environments' }, { scope: 'globals' }]
  if (/^environments:(create|delete|update|duplicate)$/.test(channel)) return [{ scope: 'environments' }]
  if (channel === 'globals:set') return [{ scope: 'globals' }]
  if (channel === 'http:send') return [{ scope: 'history' }, { scope: 'scopes' }]
  if (channel === 'history:clear' || channel === 'history:delete') return [{ scope: 'history' }]
  if (/^oauth2:(getToken|deleteToken|refresh)$/.test(channel)) return [{ scope: 'tokens' }]
  if (channel === 'state:set' && (args[0] === 'theme' || args[0] === 'activeEnvId')) return [{ scope: 'state', key: String(args[0]), value: args[1] }]
  return []
}

/** Avisa as outras janelas (não a que fez a mudança). */
export function broadcastChanges(sender: Electron.WebContents, changes: DataChange[]): void {
  if (!changes.length) return
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed() || w.webContents.id === sender.id) continue
    for (const c of changes) w.webContents.send('data:changed', c)
  }
}
