import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: {
      // o código-fonte destas bibliotecas entra no worker como texto (?raw) e roda dentro do sandbox
      externalizeDeps: { exclude: ['chai', 'lodash', 'moment', 'crypto-js', 'tv4'] },
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // worker dos scripts (sandbox da API pm)
          sandbox: resolve('src/main/sandbox/worker.ts')
        }
      }
    }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
