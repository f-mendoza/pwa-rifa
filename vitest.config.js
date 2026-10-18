import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Config aparte de vite.config.js: los tests no necesitan el service worker de vite-plugin-pwa.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/unit/**/*.test.{js,jsx}'],
    environment: 'node',
    setupFiles: ['tests/unit/setup.js'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/main.jsx'],
    },
  },
})
