import { expect, test } from '@playwright/test'

/**
 * Regression guards for counting. Read this before trusting them:
 *
 * ⚠️ THESE TESTS DO NOT PROVE THE `add()` FIX IS NECESSARY. Verified by mutation:
 * reverting `bumpQty` to read-modify-write leaves them all green. A Dexie
 * transaction serialises writes within one device, so read-modify-write is
 * genuinely correct here — there is no local bug to catch.
 *
 * `add()` exists for a failure that needs two devices and a server:
 *
 *     phone counts 50 offline    PC sets the count to 3
 *     read-modify-write -> 50 or 3, never 53
 *     add(1) x50        -> replayed against current state -> 53
 *
 * That cannot be tested until sync lands, so it is currently UNVERIFIED and rests
 * on Dexie's documented consistency semantics. What these tests do earn: proof that
 * switching to `add()` did not break local counting, and that concurrent writes to
 * one row settle correctly.
 */

test('concurrent increments of one row never lose a count', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await page.locator('dialog[open]').getByRole('button', { name: 'Založit' }).click()

  await page.getByRole('button', { name: 'Bez kódu' }).click()
  await page.locator('dialog[open]').getByLabel('Název zboží').fill('Jablka volně')
  await page.locator('dialog[open]').getByLabel('Počet kusů').fill('1')
  await page.locator('dialog[open]').getByRole('button', { name: 'Přidat' }).click()
  await expect(page.getByText('1 položka · 1 kus')).toBeVisible()

  // Fire 50 increments without awaiting each in turn — the read-modify-write version
  // interleaves reads and loses counts.
  await page.getByRole('button', { name: 'Přidat Jablka volně' }).click({ clickCount: 50, delay: 1 })
  await expect(page.getByText('1 položka · 51 kusů')).toBeVisible()
})

/**
 * The UI awaits each action in turn, so clicking can't reach the interleaving that
 * actually breaks read-modify-write. This drives db.ts directly, through the
 * production build, and fires the writes genuinely concurrently.
 */
test('concurrent recordScan calls all land — none read a stale count', async ({ page }) => {
  await page.goto('./e2e/harness.html')
  await page.waitForFunction(() => (window as any).__harnessReady === true)

  const result = await page.evaluate(async () => {
    const db = (window as any).__db
    const sessionId = await db.createSession({
      name: 'Souběh',
      place: '',
      handoverFrom: '',
      handoverTo: '',
    })
    await db.nameAndCount(sessionId, '8594001020304', 'Čokoláda hořká 70 %')

    // 30 scans launched together, as a fast scanner in a crate of one product would.
    await Promise.all(Array.from({ length: 30 }, () => db.recordScan(sessionId, '8594001020304')))

    const lines = await db.getLines(sessionId)
    return {
      rows: lines.length,
      total: lines.reduce((sum: number, l: { qty: number }) => sum + l.qty, 0),
    }
  })

  expect(result.rows, 'one product is one row').toBe(1)
  expect(result.total, 'every concurrent scan must be counted').toBe(31)
})

test('concurrent bumps in both directions settle on the right number', async ({ page }) => {
  await page.goto('./e2e/harness.html')
  await page.waitForFunction(() => (window as any).__harnessReady === true)

  const total = await page.evaluate(async () => {
    const db = (window as any).__db
    const sessionId = await db.createSession({
      name: 'Souběh',
      place: '',
      handoverFrom: '',
      handoverTo: '',
    })
    await db.addWithoutBarcode(sessionId, 'Jablka volně', 100)
    const [line] = await db.getLines(sessionId)

    // 40 up, 15 down, all at once: 100 + 40 - 15 = 125.
    await Promise.all([
      ...Array.from({ length: 40 }, () => db.bumpQty(sessionId, line.code, 1)),
      ...Array.from({ length: 15 }, () => db.bumpQty(sessionId, line.code, -1)),
    ])

    const lines = await db.getLines(sessionId)
    return lines.reduce((sum: number, l: { qty: number }) => sum + l.qty, 0)
  })

  expect(total).toBe(125)
})

test('decrementing to zero removes the line', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await page.locator('dialog[open]').getByRole('button', { name: 'Založit' }).click()

  await page.getByRole('button', { name: 'Bez kódu' }).click()
  await page.locator('dialog[open]').getByLabel('Název zboží').fill('Jablka volně')
  await page.locator('dialog[open]').getByLabel('Počet kusů').fill('2')
  await page.locator('dialog[open]').getByRole('button', { name: 'Přidat' }).click()

  await page.getByRole('button', { name: 'Ubrat Jablka volně' }).click()
  await expect(page.getByText('1 položka · 1 kus')).toBeVisible()
  await page.getByRole('button', { name: 'Ubrat Jablka volně' }).click()
  await expect(page.getByText('Zatím nic naskenováno')).toBeVisible()
})
