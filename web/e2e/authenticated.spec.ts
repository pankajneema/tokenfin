import { test, expect } from '@playwright/test'

// Runs only when E2E_EMAIL / E2E_PASSWORD are set (a TEST account on a local or
// staging stack — never a real user's password).
const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD

test.describe('authenticated', () => {
  test.skip(!EMAIL || !PASSWORD, 'set E2E_EMAIL and E2E_PASSWORD to run authenticated flows')

  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.locator('input#email').fill(EMAIL!)
    await page.locator('input#password').fill(PASSWORD!)
    await page.locator('form button[type="submit"]').click()
    await page.waitForURL(/\/(dashboard|welcome|onboarding)/, { timeout: 20_000 })
  })

  test('core dashboard pages load without an error screen', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    for (const path of ['/dashboard', '/dashboard/analytics', '/dashboard/keys', '/dashboard/settings/profile']) {
      const res = await page.goto(path)
      expect(res?.status(), path).toBeLessThan(400)
      await expect(page.locator('body')).not.toContainText(/Application error|Internal Server Error/i)
    }
    expect(errors).toEqual([])
  })
})
