import { expect, test, type Page } from '@playwright/test'

/**
 * 🔴 Guards a measured data-loss bug.
 *
 * Counting a stocktake while logged out and then signing in wipes it:
 *
 *     before login:  1 stocktake, 2 items
 *     2s after:      0 stocktakes, 0 items — silently
 *
 * Rows written while logged out belong to the `unauthorized` user; signing in
 * switches identity and the rows are pruned. The prune lands AFTER sync reports
 * itself settled, so no wait-and-check guard can catch it.
 *
 * So sign-in is offered only on an empty app, where there is provably nothing to
 * lose. If you are lifting that restriction, delete these tests only together with a
 * test proving local data survives sign-in. Not before.
 */

const syncSection = (page: Page) => page.locator('section', { hasText: 'Synchronizace s počítačem' })

async function countSomething(page: Page) {
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await page.locator('dialog[open]').getByRole('button', { name: 'Založit' }).click()
  await page.getByRole('button', { name: 'Ručně' }).click()
  await page.locator('dialog[open]').getByLabel('Čárový kód').fill('8594001020304')
  await page.locator('dialog[open]').getByRole('button', { name: 'Započítat' }).click()
  await page.locator('dialog[open]').getByLabel('Název zboží').fill('Šťavnatá hruška ďábelská')
  await page.locator('dialog[open]').getByRole('button', { name: 'Uložit a započítat' }).click()
  await expect(page.getByText('1 položka · 1 kus')).toBeVisible()
  await page.getByRole('link', { name: 'Inventury' }).click()
}

test('an empty app offers sign-in — there is nothing to lose', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('link', { name: 'Nastavení' }).click()

  await expect(syncSection(page).getByRole('button', { name: 'Přihlásit e-mailem' })).toBeVisible()
  await expect(page.getByText(/Aplikace je prázdná/)).toBeVisible()
})

/**
 * A "Přihlásit Googlem" button shipped on an assumption, and the server answered
 * `OAuth provider 'google' not configured or not enabled` — the user found it, not a
 * test. The methods on offer now come from GET /auth-providers, so the app can only
 * offer what exists.
 */
test('only offers sign-in methods the server actually has', async ({ page }) => {
  await page.goto('./')
  // Ask the server the same question the app asks — from the app's origin, since
  // that's the one the database whitelists.
  const providers = await page.evaluate(async () =>
    fetch('https://zuszhwp9s.dexie.cloud/auth-providers').then((r) => r.json()),
  )
  await page.getByRole('link', { name: 'Nastavení' }).click()
  await expect(syncSection(page).getByRole('button', { name: /Přihlásit/ }).first()).toBeVisible()

  const buttons = await syncSection(page).getByRole('button', { name: /Přihlásit/ }).allInnerTexts()
  const expected = (providers.providers as string[]).length + (providers.otpEnabled ? 1 : 0)
  expect(buttons, `server nabízí ${JSON.stringify(providers)}`).toHaveLength(expected)

  // Today the server offers no OAuth at all, so no provider button may appear.
  if (!(providers.providers as string[]).includes('google')) {
    expect(buttons.join(' ')).not.toContain('Googlem')
  }
})

test('an app holding stocktakes offers no sign-in at all', async ({ page }) => {
  await page.goto('./')
  await countSomething(page)
  await page.getByRole('link', { name: 'Nastavení' }).click()

  await expect(syncSection(page).getByRole('button', { name: /Přihlásit/ })).toHaveCount(0)
  // And says what to do instead, rather than leaving a dead panel to guess about.
  await expect(page.getByText(/Přihlášení tady zatím nenabízím/)).toBeVisible()
  await expect(page.getByText(/dej Zálohovat/)).toBeVisible()
})

/**
 * The UI hiding the button is not enough on its own: a stale render or a fast tap
 * must not be what stands between someone and losing a month of counting.
 */
test('signIn() refuses outright when data exists, whatever the UI shows', async ({ page }) => {
  await page.goto('./e2e/harness.html')
  await page.waitForFunction(() => (window as any).__harnessReady === true)

  const empty = await page.evaluate(() => (window as any).__sync.isEmpty())
  expect(empty, 'fresh app is empty').toBe(true)

  const refused = await page.evaluate(async () => {
    const { createSession, nameAndCount } = (window as any).__db
    const id = await createSession({ name: 'Data', place: '', handoverFrom: '', handoverTo: '' })
    await nameAndCount(id, '8594001020304', 'Šťavnatá hruška ďábelská')
    try {
      // Would destroy the rows just written, so it must not get as far as a network call.
      await (window as any).__sync.signIn('email')
      return { threw: false, code: '' }
    } catch (e: any) {
      // Class names are minified in the production build, so check the stable code.
      return { threw: true, code: e?.code ?? '', msg: String(e?.message ?? '') }
    }
  })

  expect(refused.threw, 'signIn must refuse when data exists').toBe(true)
  expect(refused.code).toBe('NOT_EMPTY')
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

test('sync state is reported honestly while it is off', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('link', { name: 'Nastavení' }).click()

  await expect(syncSection(page).getByRole('status')).toHaveText('Nesynchronizuje se')
  await expect(page.getByText(/Data jsou jen v tomhle zařízení/)).toBeVisible()
})
