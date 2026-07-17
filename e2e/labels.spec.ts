import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { encode } from 'uqr'
import { pdfText } from './pdf-text'
import { qrMatrixFromPdf } from './pdf-qr'

const dlg = (page: Page) => page.locator('dialog[open]')

async function learn(page: Page, code: string, name: string) {
  await page.getByRole('button', { name: 'Ručně' }).click()
  await dlg(page).getByLabel('Kód zboží').fill(code)
  await dlg(page).getByRole('button', { name: 'Započítat' }).click()
  await dlg(page).getByLabel('Název zboží').fill(name)
  await dlg(page).getByRole('button', { name: 'Uložit a započítat' }).click()
  await expect(dlg(page)).toHaveCount(0)
}

async function newSession(page: Page, name: string) {
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await dlg(page).getByLabel('Název', { exact: true }).fill(name)
  await dlg(page).getByRole('button', { name: 'Založit' }).click()
}

async function downloadLabels(page: Page, dir: string): Promise<string> {
  await page.getByRole('link', { name: 'Štítky' }).click()
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Stáhnout štítky (PDF)' }).click(),
  ]).then(([d]) => d)
  const path = join(dir, download.suggestedFilename())
  await download.saveAs(path)
  return path
}

test('prints a label per catalogued product, code and name intact', async ({ page }, testInfo) => {
  await page.goto('./')
  await newSession(page, 'Textil')
  await learn(page, '311283-194-M', 'Mikina šedá M')
  await learn(page, '309244', 'Tričko bílé')
  await page.getByRole('link', { name: 'Inventury' }).click()

  const path = await downloadLabels(page, testInfo.outputDir)
  const text = await pdfText(path)

  expect(text).toContain('311283-194-M')
  expect(text).toContain('309244')
  // Diacritics survive — same font trap as the protocol.
  expect(text).toContain('Mikina šedá M')
  expect(text).toContain('Tričko bílé')
})

/**
 * Loose goods carry a synthetic internal id. On a label it would read as a real code
 * and send someone hunting for it — so the label shows the name and the QR carries the
 * id quietly. Same rule as the protocol's "bez kódu".
 */
test('a label never prints the synthetic id of loose goods', async ({ page }, testInfo) => {
  await page.goto('./')
  await newSession(page, 'Ovoce')
  await page.getByRole('button', { name: 'Bez kódu' }).click()
  await dlg(page).getByLabel('Název zboží').fill('Jablka volně')
  await dlg(page).getByLabel('Počet kusů').fill('5')
  await dlg(page).getByRole('button', { name: 'Přidat' }).click()
  await page.getByRole('link', { name: 'Inventury' }).click()

  const text = await pdfText(await downloadLabels(page, testInfo.outputDir))

  expect(text).toContain('Jablka volně')
  expect(text).not.toContain('bez-kodu:')
})

/**
 * The one thing that decides whether this feature works at all.
 *
 * The QR is drawn as rectangles, so a mirrored, offset or mis-scaled symbol still looks
 * like a QR on screen and simply never scans — and every other test here would stay
 * green. Comparing module for module against the encoder's own output is what catches
 * it. That the encoder's output scans is pinned separately, in scanner.spec.ts; the two
 * together mean the printed label reads.
 */
test('the QR on the label is the encoder output, module for module', async ({ page }, testInfo) => {
  const code = '311283-194-M'

  await page.goto('./')
  await newSession(page, 'Textil')
  await learn(page, code, 'Mikina šedá M')
  await page.getByRole('link', { name: 'Inventury' }).click()

  const path = await downloadLabels(page, testInfo.outputDir)
  // Mirrors the options in lib/labels.ts on purpose: changing the error correction or
  // the quiet zone changes what gets printed, and that should have to be deliberate.
  const expected = encode(code, { border: 4, ecc: 'M' }).data
  expect(await qrMatrixFromPdf(path, expected)).toEqual(expected)
})

test('the labels screen says what it will print before printing it', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('link', { name: 'Štítky' }).click()
  await expect(page.getByText('Zatím není co tisknout')).toBeVisible()

  await page.getByRole('link', { name: 'Inventury' }).click()
  await newSession(page, 'Textil')
  await learn(page, '311283-194-M', 'Mikina šedá M')
  await page.getByRole('link', { name: 'Inventury' }).click()
  await page.getByRole('link', { name: 'Štítky' }).click()

  await expect(page.getByText('1 druh zboží — 1 strana A4')).toBeVisible()
})
