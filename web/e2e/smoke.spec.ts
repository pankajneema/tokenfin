import { test, expect } from '@playwright/test'

// Unauthenticated smoke: no credentials, no data needed.

test('login page renders the sign-in form', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('input#email')).toBeVisible()
  await expect(page.locator('input#password')).toBeVisible()
  await expect(page.getByRole('button', { name: /sign in/i }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /forgot password/i })).toBeVisible()
})

test('signup and forgot-password pages render', async ({ page }) => {
  for (const path of ['/signup', '/forgot-password']) {
    const res = await page.goto(path)
    expect(res?.status(), path).toBeLessThan(400)
    await expect(page.locator('input[type="email"]').first()).toBeVisible()
  }
})

test('legal pages are public', async ({ page }) => {
  for (const path of ['/privacy', '/terms']) {
    const res = await page.goto(path)
    expect(res?.status(), path).toBe(200)
    expect(page.url()).toContain(path)
  }
})

test('dashboard redirects anonymous users to login with ?next', async ({ page }) => {
  await page.goto('/dashboard/analytics')
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fanalytics/)
})

test('/api/health reports status without secrets', async ({ request }) => {
  const res = await request.get('/api/health')
  expect([200, 503]).toContain(res.status())
  const body = await res.json()
  expect(Object.keys(body).sort()).toEqual(['db', 'migrations', 'ok', 'version'])
  expect(typeof body.version).toBe('string')
  expect(res.headers()['cache-control']).toMatch(/max-age=\d+/)
  expect(JSON.stringify(body)).not.toMatch(/eyJ|postgres(ql)?:\/\/|tfk_|sk-/)
})

test('protected APIs reject anonymous callers', async ({ request }) => {
  expect((await request.get('/api/v1/keys?org_id=00000000-0000-4000-8000-000000000000')).status()).toBe(401)
  expect((await request.get('/api/v1/cron/alerts')).status()).toBe(401)
  expect((await request.get('/api/v1/cron/retention', { headers: { authorization: 'Bearer wrong' } })).status()).toBe(401)
  expect((await request.post('/api/v1/ingest', { data: { model: 'x' } })).status()).toBe(401)
})
