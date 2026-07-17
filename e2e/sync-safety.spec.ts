import { expect, test } from '@playwright/test'

/**
 * 🔴 Guards a measured data-loss bug.
 *
 * Counting a stocktake while logged out and then signing in wipes it:
 *
 *     before login:  1 stocktake, 2 items
 *     2s after:      0 stocktakes, 0 items — silently
 *
 * Rows written while logged out belong to the `unauthorized` user; logging in
 * switches identity and the first sync prunes them. Until a data-preserving sign-in
 * is proven, the app must not offer a button that can do it.
 *
 * If you are re-enabling sign-in: delete these tests only together with a test that
 * proves local data survives it. Not before.
 */

test('the app never offers a sign-in that would wipe local data', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('link', { name: 'Nastavení' }).click()

  await expect(page.getByRole('button', { name: /Přihlásit/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'E-mailem' })).toHaveCount(0)
  // And says why, rather than leaving a dead panel the user has to guess about.
  await expect(page.getByText(/Přihlašování je dočasně vypnuté/)).toBeVisible()
})

test('sync state is reported honestly while it is off', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('link', { name: 'Nastavení' }).click()

  const status = page.locator('section', { hasText: 'Synchronizace' }).getByRole('status')
  await expect(status).toHaveText('Nesynchronizuje se')
  await expect(page.getByText(/Data jsou jen v tomhle zařízení/)).toBeVisible()
})

test('counting, protocols and backup all still work with sync off', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await page.locator('dialog[open]').getByRole('button', { name: 'Založit' }).click()

  await page.getByRole('button', { name: 'Ručně' }).click()
  await page.locator('dialog[open]').getByLabel('Čárový kód').fill('8594001020304')
  await page.locator('dialog[open]').getByRole('button', { name: 'Započítat' }).click()
  await page.locator('dialog[open]').getByLabel('Název zboží').fill('Šťavnatá hruška ďábelská')
  await page.locator('dialog[open]').getByRole('button', { name: 'Uložit a započítat' }).click()
  await expect(page.getByText('1 položka · 1 kus')).toBeVisible()

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Stáhnout předávací protokol/ }).click(),
  ]).then(([d]) => d)
  expect(download.suggestedFilename()).toMatch(/\.pdf$/)
})
