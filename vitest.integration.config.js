import { defineConfig } from 'vitest/config'

// Integración real contra la API Laravel (api/): levanta PHP con una base SQLite temporal.
// Aparte de `npm test` para no exigir PHP. Ver README → "Rifas en la nube".
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.js'],
    environment: 'node',
    setupFiles: ['tests/unit/setup.js'],
    globalSetup: ['tests/integration/globalSetup.js'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
