import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type JeffPostmanBridge, type IpcChannel } from '@shared/types'

const allowed = new Set<IpcChannel>(IPC_CHANNELS)

const bridge: JeffPostmanBridge = {
  invoke(channel, ...args) {
    if (!allowed.has(channel)) return Promise.reject(new Error(`Canal IPC não permitido: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  }
}

contextBridge.exposeInMainWorld('jeffPostman', bridge)
