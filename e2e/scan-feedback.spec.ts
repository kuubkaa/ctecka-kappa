import sharp from 'sharp'
import { expect, test, type Page } from '@playwright/test'
import { FAKE_CAMERA_CODE } from './fake-camera'

/**
 * Drives the whole real path — Chromium's fake camera streams an actual EAN-13, the
 * wasm engine decodes it off the video, the app counts it, and the confirmation
 * fires. Every other spec stops at manual entry and never opens the camera.
 *
 * The confirmation exists because a warehouse is loud and the user is looking at the
 * barcode, not the phone. So it lands on three channels: sound, vibration, flash.
 * Sound can't be observed from Playwright; the other two can, and are.
 */

/** Records navigator.vibrate calls, which are otherwise invisible to the test. */
async function stubVibrate(page: Page) {
  await page.addInitScript(() => {
    ;(window as any).__vibrations = []
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (pattern: number | number[]) => {
        ;(window as any).__vibrations.push(pattern)
        return true
      },
    })
  })
}

const vibrations = (page: Page) =>
  page.evaluate(() => (window as any).__vibrations as Array<number | number[]>)

async function startScanning(page: Page) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await page.locator('dialog[open]').getByRole('button', { name: 'Založit' }).click()
  await page.getByRole('button', { name: 'Skenovat' }).click()
}

test('camera scan counts the item and confirms loudly', async ({ page }) => {
  await stubVibrate(page)
  await startScanning(page)

  // First sighting of an unknown code: the app must stop and ask for a name rather
  // than invent one. This only fires if the wasm engine read the barcode off the
  // live camera stream.
  const dialog = page.locator('dialog[open]')
  await expect(dialog.getByRole('heading', { name: 'Nové zboží' })).toBeVisible({ timeout: 15_000 })
  await expect(dialog.getByText(FAKE_CAMERA_CODE)).toBeVisible()

  // An unknown code buzzes differently from a successful count, so the user can tell
  // "needs you" from "done" without looking at the screen.
  expect((await vibrations(page))[0], 'unknown code buzzes once, long').toEqual([140])

  await dialog.getByLabel('Název zboží').fill('Šťavnatá hruška ďábelská')
  await dialog.getByRole('button', { name: 'Uložit a započítat' }).click()

  // Confirmation card: name, and a count big enough to read at arm's length.
  const card = page.getByRole('status')
  await expect(card).toBeVisible()
  await expect(card.getByText('Šťavnatá hruška ďábelská')).toBeVisible()
  await expect(card.getByText('1', { exact: true })).toBeVisible()
  await expect(card.getByText('kus celkem')).toBeVisible()

  // The camera still sees the same barcode, so once the rescan cooldown lapses it
  // counts again by itself — which is how counting a crate of one product works.
  await expect(card.getByText('2', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(card.getByText('kusy celkem')).toBeVisible()

  const buzzes = await vibrations(page)
  expect(buzzes.length, 'every scan buzzes').toBeGreaterThanOrEqual(2)
  expect(buzzes.at(-1), 'a counted scan is a double pulse').toEqual([40, 50, 40])

  await page.getByRole('button', { name: 'Hotovo' }).click()
  await expect(page.getByText('1 položka · 2 kusy')).toBeVisible()
})

/**
 * Samples what is actually on screen rather than reading CSS. Class names and colour
 * formats are implementation detail — Tailwind v4 reports oklab(), not rgb() — but
 * "the screen turns green" is the whole point of the feature.
 */
async function sampleFlashColour(page: Page) {
  // The camera keeps re-scanning every ~1.2s, so a missed frame just retries.
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[aria-hidden]')
          return !!el && parseFloat(getComputedStyle(el).opacity) > 0.95
        },
        { timeout: 4000, polling: 'raf' },
      )
    } catch {
      continue
    }
    // Top-left corner: away from the confirmation card and the viewfinder cut-out.
    const shot = await page.screenshot({ clip: { x: 8, y: 90, width: 24, height: 24 } })
    const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true })
    let r = 0
    let g = 0
    let b = 0
    const px = info.width * info.height
    for (let i = 0; i < px; i++) {
      r += data[i * info.channels]!
      g += data[i * info.channels + 1]!
      b += data[i * info.channels + 2]!
    }
    const avg = { r: r / px, g: g / px, b: b / px }
    if (avg.g > avg.r && avg.g > avg.b) return avg
  }
  return null
}

test('the whole screen flashes green on a scan, not just a corner', async ({ page }) => {
  await stubVibrate(page)
  await startScanning(page)

  const dialog = page.locator('dialog[open]')
  await expect(dialog.getByRole('heading', { name: 'Nové zboží' })).toBeVisible({ timeout: 15_000 })
  await dialog.getByLabel('Název zboží').fill('Müsli tyčinka')
  await dialog.getByRole('button', { name: 'Uložit a započítat' }).click()

  const geometry = await page.evaluate(() => {
    const el = document.querySelector('[aria-hidden]')!
    const box = el.getBoundingClientRect()
    return { coversViewport: box.width >= innerWidth && box.height >= innerHeight }
  })
  expect(geometry.coversViewport, 'a corner toast is too easy to miss').toBe(true)

  const avg = await sampleFlashColour(page)
  expect(avg, 'the screen never turned green').not.toBeNull()
  // Green must actually dominate — not a barely-tinted wash.
  expect(avg!.g - avg!.r, 'green must clearly beat red').toBeGreaterThan(15)
  expect(avg!.g - avg!.b, 'green must clearly beat blue').toBeGreaterThan(5)
})
