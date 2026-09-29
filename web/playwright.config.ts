import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright smoke tests (web/e2e). They need a RUNNING app — they never start
 * `next dev` against your .env.local (which may point at a live project).
 *
 *   E2E_BASE_URL   app to test (default http://localhost:3002, the local stack)
 *   E2E_START_SERVER=1  CI only: `next start -p 3002` from a prior `next build`,
 *                  using whatever NEXT_PUBLIC_SUPABASE_* the job exported (local Supabase)
 *   E2E_EMAIL / E2E_PASSWORD  enable the authenticated specs (skipped otherwise)
 *
 *   npx playwright install chromium   # once
 *   npm run test:e2e
 */
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3002'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_START_SERVER
    ? { command: 'npx next start -p 3002', url: `${baseURL}/login`, reuseExistingServer: false, timeout: 120_000 }
    : undefined,
})
