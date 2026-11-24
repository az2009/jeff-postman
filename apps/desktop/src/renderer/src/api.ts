import type { JeffPostmanBridge } from '@shared/types'

/** Ponte para o processo principal. Fora do Electron (navegador puro) cai num stub em memória. */
export const api: JeffPostmanBridge =
  typeof window !== 'undefined' && window.jeffPostman ? window.jeffPostman : createMemoryStub()

function createMemoryStub(): JeffPostmanBridge {
  const state = new Map<string, unknown>()
  return {
    async invoke(channel, ...args) {
      switch (channel) {
        case 'state:get':
          return (state.get(args[0] as string) ?? null) as never
        case 'state:set':
          state.set(args[0] as string, args[1])
          return undefined as never
        case 'collections:list':
        case 'environments:list':
        case 'items:list':
          return [] as never
        default:
          throw new Error(`Sem Electron: ${channel}`)
      }
    }
  }
}
