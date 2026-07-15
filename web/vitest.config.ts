import { defineConfig } from 'vitest/config'
import path from 'path'

// Node-environment unit tests. The `@/` alias mirrors tsconfig paths so tests
// import the real modules (not copies).
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
