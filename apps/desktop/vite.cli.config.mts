// Build do comando de terminal (jeff-postman) e do worker dos scripts para out/cli, em CommonJS para Node.
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  ssr: { noExternal: true },
  build: {
    ssr: true,
    outDir: 'out/cli',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      input: {
        'jeff-postman': resolve(import.meta.dirname, 'src/cli/index.ts'),
        sandbox: resolve(import.meta.dirname, 'src/main/sandbox/worker.ts')
      },
      output: { format: 'cjs', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' }
    }
  }
})
