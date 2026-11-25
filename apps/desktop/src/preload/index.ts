import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNELS, IPC_CHANNELS, type EventChannel, type JeffPostmanBridge, type IpcChannel } from '@shared/types'

const allowed = new Set<IpcChannel>(IPC_CHANNELS)

const bridge: JeffPostmanBridge = {
  invoke(channel, ...args) {
    if (!allowed.has(channel)) return Promise.reject(new Error(`Canal IPC não permitido: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  on(channel, cb) {
    if (!(EVENT_CHANNELS as readonly string[]).includes(channel)) throw new Error(`Evento não permitido: ${channel}`)
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload)
    ipcRenderer.on(channel as EventChannel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('jeffPostman', bridge)
