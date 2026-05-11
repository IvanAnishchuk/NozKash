import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['e2e/fixtures/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/e2e/**/*.spec.ts'],
    environment: 'node',
  },
})
