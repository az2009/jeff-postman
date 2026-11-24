import type { JeffPostmanBridge } from '../shared/types'

declare global {
  interface Window {
    jeffPostman: JeffPostmanBridge
  }
}

export {}
