// Build do comando de terminal (jeff-postman) e do worker dos scripts para out/cli, em CommonJS para Node.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }

export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  // a versão do CLI sai do package.json (antes ficava escrita à mão no código)
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
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
