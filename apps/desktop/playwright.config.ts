import { defineConfig } from '@playwright/test'

// Testes de ponta a ponta: abrem o app Electron já compilado (npm run build) com uma pasta de dados temporária.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' }
})
