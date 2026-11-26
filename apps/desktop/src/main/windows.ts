/**
 * Janelas do app: a principal e as destacadas (com abas próprias, como as janelas destacadas do IntelliJ).
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
  /** já pode fechar sem devolver a aba (devolvida, ou não há janela principal) */
  released: boolean
}

let mainWindow: BrowserWindow | null = null
const detached = new Map<number, Detached>()
/** requisições abertas em cada janela (id do webContents), para não abrir a mesma em duas */
const openItems = new Map<number, string[]>()
/** janelas da mais recente para a mais antiga em foco: a de cima vence quando se sobrepõem */
let focusOrder: number[] = []

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
  focusOrder.unshift(id)
  win.on('focus', () => (focusOrder = [id, ...focusOrder.filter((x) => x !== id)]))
  win.on('closed', () => {
    focusOrder = focusOrder.filter((x) => x !== id)
    openItems.delete(id)
  })
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
    const entry: Detached = { win, pending: null, released: false }
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

/** Manda abas para uma janela do app, na posição de soltar (convertida para a tela dela). */
function sendTo(target: BrowserWindow | null, snapshots: TabSnapshot[], point: ScreenPoint | null): boolean {
  if (!target || target.isDestroyed()) return false
  const cb = target.getContentBounds()
  const client = point ? { clientX: point.x - cb.x, clientY: point.y - cb.y } : null
  if (snapshots.length) target.webContents.send('window:attachTab', { snapshots, ...client })
  if (target.isMinimized()) target.restore()
  target.focus()
  return true
}

/** Janela do app por id do webContents (só as que este módulo criou). */
function appWindow(id: number): BrowserWindow | null {
  const main = getMainWindow()
  if (main && main.webContents.id === id) return main
  const d = detached.get(id)
  return d && !d.win.isDestroyed() ? d.win : null
}

/** Janela do app que está no ponto (a mais recente em foco quando se sobrepõem). */
function windowAt(senderId: number, p: ScreenPoint): { over: 'self' | 'window' | 'outside'; target: number | null } {
  for (const id of focusOrder) {
    const w = appWindow(id)
    if (!w || !w.isVisible() || w.isMinimized() || !contains(w.getBounds(), p)) continue
    return id === senderId ? { over: 'self', target: null } : { over: 'window', target: id }
  }
  return { over: 'outside', target: null }
}

// ---------- arrasto de aba: etiqueta que segue o mouse fora da janela e destaque do destino ----------
let dragTimer: ReturnType<typeof setInterval> | null = null
let ghost: BrowserWindow | null = null
let ghostLabel = ''
let ghostSize = { width: 300, height: 32 }
let hintTarget: number | null = null

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function ghostHtml(label: string, ok: boolean): string {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"></head>
<body style="margin:0;height:100vh;box-sizing:border-box;display:flex;align-items:center;padding:0 12px;background:#2b2b2b;color:#eee;border:1px solid ${ok ? '#ff6c37' : '#666'};overflow:hidden;font:12px 'Segoe UI',sans-serif;white-space:nowrap;text-overflow:ellipsis">${escapeHtml(label)}
</body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function setHint(target: number | null): void {
  if (target === hintTarget) return
  if (hintTarget !== null) appWindow(hintTarget)?.webContents.send('window:dropHint', { active: false })
  if (target !== null) appWindow(target)?.webContents.send('window:dropHint', { active: true })
  hintTarget = target
}

function dragStop(): void {
  if (dragTimer) clearInterval(dragTimer)
  dragTimer = null
  setHint(null)
  // a etiqueta é destruída (uma janela escondida impediria o app de fechar)
  if (ghost && !ghost.isDestroyed()) ghost.destroy()
  ghost = null
  ghostLabel = ''
}

function dragStart(senderId: number, title: string, canDetach: boolean): void {
  dragStop()
  ghost = new BrowserWindow({
    width: 300,
    height: 32,
    frame: false,
    // janela sólida (a transparente não é desenhada de forma confiável no Windows com escala de tela)
    backgroundColor: '#2b2b2b',
    roundedCorners: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false }
  })
  ghost.setIgnoreMouseEvents(true)
  // no Windows a opção alwaysOnTop do construtor não vale para janela que não recebe foco: a etiqueta
  // ficava atrás das janelas do app. O nível 'screen-saver' a põe acima de tudo durante o arrasto.
  ghost.setAlwaysOnTop(true, 'screen-saver')
  ghost.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  ghost.webContents.on('will-navigate', (e) => e.preventDefault())
  const started = Date.now()
  dragTimer = setInterval(() => {
    const g = ghost
    if (!g || g.isDestroyed() || !appWindow(senderId) || Date.now() - started > 120_000) return dragStop()
    const p = screen.getCursorScreenPoint()
    const w = windowAt(senderId, p)
    setHint(w.over === 'window' ? w.target : null)
    // dentro da própria janela não há etiqueta (lá a aba só muda de lugar na barra)
    const label = w.over === 'self' ? '' : w.over === 'window' ? `⤶  Anexar aqui: ${title}` : canDetach ? `⧉  Nova janela: ${title}` : 'Solte sobre uma janela do app'
    if (!label) {
      if (g.isVisible()) g.hide()
      return
    }
    if (label !== ghostLabel) {
      ghostLabel = label
      ghostSize = { width: Math.min(420, 30 + label.length * 7), height: 32 }
      void g.loadURL(ghostHtml(label, w.over === 'window' || canDetach)).catch(() => undefined)
    }
    // posição e tamanho juntos: só setPosition faz a janela crescer a cada passo no Windows com escala de tela
    g.setBounds({ x: Math.round(p.x + 16), y: Math.round(p.y + 14), ...ghostSize })
    if (!g.isVisible()) {
      g.showInactive()
      g.moveTop()
    }
  }, 16)
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
      if (!sendTo(getMainWindow(), Array.isArray(snapshots) ? snapshots : [], null)) {
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
    'window:moveTo': (e, snapshot, point, target) => {
      const win = target === null ? getMainWindow() : appWindow(Number(target))
      if (!win || win.webContents.id === e.sender.id) return false
      return sendTo(win, [snapshot], point)
    },
    'window:dragStart': (e, info) => {
      dragStart(e.sender.id, String(info?.title ?? '').slice(0, 60), info?.canDetach !== false)
    },
    'window:dragEnd': (e, point) => {
      dragStop()
      const valid = point && Number.isFinite(point.x) && Number.isFinite(point.y)
      const p = valid ? { x: Math.round(point.x), y: Math.round(point.y) } : screen.getCursorScreenPoint()
      return { ...windowAt(e.sender.id, p), ...p }
    },
    'window:setTabInfo': (e, info) => {
      openItems.set(e.sender.id, Array.isArray(info.itemIds) ? info.itemIds.filter((x) => typeof x === 'string') : [])
      const d = detached.get(e.sender.id)
      if (d && typeof info.title === 'string') d.win.setTitle(`${info.title} · JEFF Postman`)
    },
    'window:focusItem': (e, itemId) => {
      for (const [id, items] of openItems) {
        if (id === e.sender.id || !items.includes(itemId)) continue
        const w = appWindow(id)
        if (!w) continue
        if (w.isMinimized()) w.restore()
        w.focus()
        return true
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
