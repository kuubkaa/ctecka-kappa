import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { devices, expect, test, type Browser, type Page } from '@playwright/test'

/**
 * The backup is the app's only way out: everything lives in one phone's IndexedDB,
 * so a lost phone is a lost stocktake. It's also the migration tool and the escape
 * hatch from the sync vendor — which makes "restore must never eat live data" the
 * property that matters most here.
 *
 * A second device is a second browser context, not a wiped database: deleting an
 * IndexedDB the app still holds open just blocks until the connection closes, so
 * the "clean device" would silently still have its data.
 */
async function secondDevice(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    baseURL: test.info().project.use.baseURL,
  })
  return context.newPage()
}

const dlg = (page: Page) => page.locator('dialog[open]')

async function newSession(page: Page, name: string) {
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await dlg(page).getByLabel('Název', { exact: true }).fill(name)
  await dlg(page).getByRole('button', { name: 'Založit' }).click()
}

async function addItem(page: Page, code: string, name: string) {
  await page.getByRole('button', { name: 'Ručně' }).click()
  await dlg(page).getByLabel('Kód zboží').fill(code)
  await dlg(page).getByRole('button', { name: 'Započítat' }).click()
  await dlg(page).getByLabel('Název zboží').fill(name)
  await dlg(page).getByRole('button', { name: 'Uložit a započítat' }).click()
  await expect(dlg(page)).toHaveCount(0)
}

/** Settings lives on the home screen, so a session screen has to go back first. */
async function openSettings(page: Page) {
  const back = page.getByRole('link', { name: 'Inventury' })
  if (await back.isVisible()) await back.click()
  await page.getByRole('link', { name: 'Nastavení' }).click()
}

async function saveBackup(page: Page, dir: string): Promise<string> {
  await openSettings(page)
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Zálohovat' }).click(),
  ]).then(([d]) => d)
  const path = join(dir, download.suggestedFilename())
  await download.saveAs(path)
  return path
}

/**
 * The backup section's own live region — Settings also has one for sync status.
 * Matched by heading, not by text: hasText is a case-insensitive substring match,
 * and the sync section's copy mentions "záloha" too.
 */
const backupStatus = (page: Page) =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Záloha', exact: true }) })
    .getByRole('status')

async function restore(page: Page, path: string) {
  await openSettings(page)
  await page.getByLabel('Vybrat soubor se zálohou').setInputFiles(path)
  await expect(dlg(page).getByRole('heading', { name: 'Načíst zálohu?' })).toBeVisible()
  await dlg(page).getByRole('button', { name: 'Načíst' }).click()
  await expect(backupStatus(page)).toContainText('Načteno')
}

test('backs up everything and restores it onto another device', async ({
  page,
  browser,
}, testInfo) => {
  await page.goto('./')
  await page.getByRole('link', { name: 'Nastavení' }).click()
  await page.getByLabel('Název firmy').fill('Žluťoučký kůň, s.r.o.')
  await page.getByLabel('Název firmy').blur()
  await expect(page.getByText('Uloženo')).toBeVisible()
  await page.getByRole('link', { name: 'Inventury' }).click()

  await newSession(page, 'Inventura ke zálohování')
  await addItem(page, '8594001020304', 'Šťavnatá hruška ďábelská')
  await page.getByRole('button', { name: 'Bez kódu' }).click()
  await dlg(page).getByLabel('Název zboží').fill('Jablka volně')
  await dlg(page).getByLabel('Počet kusů').fill('12')
  await dlg(page).getByRole('button', { name: 'Přidat' }).click()

  const path = await saveBackup(page, testInfo.outputDir)

  const backup = JSON.parse(await readFile(path, 'utf8'))
  expect(backup.format).toBe('ctecka-kappa-backup')
  expect(backup.sessions).toHaveLength(1)
  expect(backup.items).toHaveLength(2)
  expect(backup.products).toHaveLength(2)
  // Czech survives the round trip through JSON.
  expect(JSON.stringify(backup)).toContain('Šťavnatá hruška ďábelská')

  const pc = await secondDevice(browser)
  await pc.goto('./')
  await expect(pc.getByText('Zatím žádná inventura')).toBeVisible()

  await restore(pc, path)
  await pc.getByRole('link', { name: 'Inventury' }).click()
  await pc.getByText('Inventura ke zálohování').click()
  await expect(pc.getByText('2 položky · 13 kusů')).toBeVisible()
  await expect(pc.getByText('Šťavnatá hruška ďábelská')).toBeVisible()
  await expect(pc.getByText('Jablka volně')).toBeVisible()
  // Loose goods stay loose — not resurrected as a fake barcode.
  await expect(pc.getByText('bez čárového kódu')).toBeVisible()
})

/**
 * The worst possible bug in a backup feature is a restore that eats live data. A
 * duplicated stocktake is annoying; an erased one is unrecoverable — so import adds.
 */
test('restoring never destroys what is already on the device', async ({
  page,
  browser,
}, testInfo) => {
  await page.goto('./')
  await newSession(page, 'Ze zálohy')
  await addItem(page, '8594001020304', 'Zboží ze zálohy')
  const path = await saveBackup(page, testInfo.outputDir)

  const pc = await secondDevice(browser)
  await pc.goto('./')
  await newSession(pc, 'Rozpočítaná na místě')
  await addItem(pc, '8594001020399', 'Rozpočítané zboží')

  await restore(pc, path)

  await pc.getByRole('link', { name: 'Inventury' }).click()
  await expect(pc.getByText('Rozpočítaná na místě')).toBeVisible()
  await expect(pc.getByText('Ze zálohy')).toBeVisible()

  // The in-progress stocktake still holds its own count, not the backup's.
  await pc.getByText('Rozpočítaná na místě').click()
  await expect(pc.getByText('Rozpočítané zboží')).toBeVisible()
  await expect(pc.getByText('1 položka · 1 kus')).toBeVisible()
})

test('two devices that both numbered a stocktake "1" do not fuse into one', async ({
  page,
  browser,
}, testInfo) => {
  await page.goto('./')
  await newSession(page, 'Telefon')
  await addItem(page, '8594001020304', 'Zboží z telefonu')
  const path = await saveBackup(page, testInfo.outputDir)

  // Session ids are per-device counters, so the file's id 1 and this device's id 1
  // are different stocktakes.
  const pc = await secondDevice(browser)
  await pc.goto('./')
  await newSession(pc, 'Počítač')
  await addItem(pc, '8594001020399', 'Zboží z počítače')

  await restore(pc, path)

  await pc.getByRole('link', { name: 'Inventury' }).click()
  await pc.getByText('Telefon', { exact: true }).click()
  await expect(pc.getByText('Zboží z telefonu')).toBeVisible()
  await expect(pc.getByText('Zboží z počítače')).toBeHidden()
  await expect(pc.getByText('1 položka · 1 kus')).toBeVisible()
})

test('a file that is not our backup is refused, not half-imported', async ({ page }, testInfo) => {
  await page.goto('./')
  await newSession(page, 'Nedotknutelná')
  await addItem(page, '8594001020304', 'Zůstane tady')
  await openSettings(page)

  // Playwright only creates outputDir when it first writes there itself.
  await mkdir(testInfo.outputDir, { recursive: true })

  const junk = join(testInfo.outputDir, 'neco-jineho.json')
  await writeFile(junk, JSON.stringify({ hello: 'world' }))
  await page.getByLabel('Vybrat soubor se zálohou').setInputFiles(junk)
  await expect(backupStatus(page)).toContainText('není záloha z této aplikace')
  await expect(dlg(page)).toHaveCount(0)

  const broken = join(testInfo.outputDir, 'rozbity.json')
  await writeFile(broken, 'tohle rozhodně není JSON {{{')
  await page.getByLabel('Vybrat soubor se zálohou').setInputFiles(broken)
  await expect(backupStatus(page)).toContainText('nejde přečíst')

  // Data untouched throughout.
  await page.getByRole('link', { name: 'Inventury' }).click()
  await expect(page.getByText('Nedotknutelná')).toBeVisible()
})
