import { expect, test, type Page } from '@playwright/test'
import { FAKE_CAMERA_CODE } from './fake-camera'

/**
 * The backup file is the only copy that survives a lost phone, so the app nags —
 * but a nag that fires when there's nothing to save trains people to dismiss it
 * unread, and then it's useless on the day it matters. These pin both halves.
 */

const reminder = (page: Page) =>
  page.locator('dialog[open]').filter({ hasText: 'Zálohuj si inventuru' })

/**
 * Counts the barcode the fake camera actually streams, so that opening the scanner
 * counts it rather than popping the "unknown code" dialog — which would block the
 * scanner's own buttons and make the scan test pass for the wrong reason.
 */
async function countSomething(page: Page, name = 'Šťavnatá hruška ďábelská') {
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await page.locator('dialog[open]').getByRole('button', { name: 'Založit' }).click()
  await page.getByRole('button', { name: 'Ručně' }).click()
  await page.locator('dialog[open]').getByLabel('Kód zboží').fill(FAKE_CAMERA_CODE)
  await page.locator('dialog[open]').getByRole('button', { name: 'Započítat' }).click()
  await page.locator('dialog[open]').getByLabel('Název zboží').fill(name)
  await page.locator('dialog[open]').getByRole('button', { name: 'Uložit a započítat' }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
}

test('an empty app is never nagged — there is nothing to lose', async ({ page }) => {
  await page.goto('./')
  // Well past the reminder's own delay.
  await page.waitForTimeout(4000)
  await expect(reminder(page)).toHaveCount(0)
})

test('nags once something has been counted', async ({ page }) => {
  await page.goto('./')
  await countSomething(page)
  await expect(reminder(page)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/Data jsou jen v tomhle zařízení/)).toBeVisible()
})

test('backs up from the reminder itself, without sending anyone to Settings', async ({ page }) => {
  await page.goto('./')
  await countSomething(page)
  await expect(reminder(page)).toBeVisible({ timeout: 10_000 })

  const download = await Promise.all([
    page.waitForEvent('download'),
    reminder(page).getByRole('button', { name: 'Zálohovat' }).click(),
  ]).then(([d]) => d)
  expect(download.suggestedFilename()).toMatch(/^inventura-zaloha-.*\.json$/)

  await expect(page.getByText(/Soubor máš ve Stažených souborech/)).toBeVisible()
})

test('stops nagging once the backup is taken', async ({ page }) => {
  await page.goto('./')
  await countSomething(page)
  await expect(reminder(page)).toBeVisible({ timeout: 10_000 })
  await Promise.all([
    page.waitForEvent('download'),
    reminder(page).getByRole('button', { name: 'Zálohovat' }).click(),
  ])
  await expect(reminder(page)).toHaveCount(0, { timeout: 6000 })

  // A reload with nothing new counted must stay quiet.
  await page.reload()
  await page.waitForTimeout(4000)
  await expect(reminder(page)).toHaveCount(0)
})

test('nags again once something new is counted after a backup', async ({ page }) => {
  await page.goto('./')
  await countSomething(page)
  await expect(reminder(page)).toBeVisible({ timeout: 10_000 })
  await Promise.all([
    page.waitForEvent('download'),
    reminder(page).getByRole('button', { name: 'Zálohovat' }).click(),
  ])
  await expect(reminder(page)).toHaveCount(0, { timeout: 6000 })

  // New counting means the file on disk is now out of date — say so.
  await page.getByRole('button', { name: 'Přidat Šťavnatá hruška ďábelská' }).click()
  await expect(page.getByText('1 položka · 2 kusy')).toBeVisible()
  await page.reload()
  await expect(reminder(page)).toBeVisible({ timeout: 10_000 })
})

/**
 * Caught by the scanner suite failing, not by design: the reminder could land on
 * top of a live viewfinder. Someone up a ladder pointing a phone at a shelf does
 * not need a dialog — that's worse than no reminder at all.
 */
test('never interrupts a scan', async ({ page }) => {
  await page.goto('./')
  await countSomething(page)
  await expect(reminder(page)).toBeVisible({ timeout: 10_000 })
  await reminder(page).getByRole('button', { name: 'Teď ne' }).click()

  // Clear the snooze so only the scanner is holding it back.
  await page.evaluate(() => localStorage.removeItem('ctecka-kappa:backup-reminder-snoozed-until'))
  await page.getByRole('button', { name: 'Skenovat' }).click()
  await expect(page.locator('video')).toBeVisible()

  // Well past every trigger the reminder has.
  await page.waitForTimeout(5000)
  await expect(reminder(page), 'nesmí vyskočit přes kameru').toHaveCount(0)

  // And once the camera is down, it may speak again.
  await page.getByRole('button', { name: 'Hotovo' }).click()
  await expect(page.locator('video')).toHaveCount(0)
  await page.reload()
  await expect(reminder(page)).toBeVisible({ timeout: 10_000 })
})

test('"Teď ne" buys real quiet, not a reappearance two seconds later', async ({ page }) => {
  await page.goto('./')
  await countSomething(page)
  await expect(reminder(page)).toBeVisible({ timeout: 10_000 })
  await reminder(page).getByRole('button', { name: 'Teď ne' }).click()
  await expect(reminder(page)).toHaveCount(0)

  // A nag the user has to fight is a nag the user defeats.
  await page.reload()
  await page.waitForTimeout(4000)
  await expect(reminder(page)).toHaveCount(0)
})
