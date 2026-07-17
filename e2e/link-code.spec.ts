import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

/**
 * Pointing an unknown code at goods the catalog already holds.
 *
 * The failure this exists to prevent is quiet: name the goods a second time and the
 * stocktake carries two lines for one product, which is a defect on a document someone
 * signs. Naming genuinely new goods still has to work — hence two ways out of the
 * dialog, not one.
 */

const SHEET =
  'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0'

const dlg = (page: Page) => page.locator('dialog[open]')

async function stubSheet(page: Page, body: string) {
  await page.route('https://docs.google.com/**/gviz/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body }),
  )
}

async function loadCatalog(page: Page, body: string) {
  await stubSheet(page, body)
  // Settings lives on the home screen, so a session screen has to go back first.
  const back = page.getByRole('link', { name: 'Inventury' })
  if (await back.isVisible()) await back.click()
  await page.getByRole('link', { name: 'Nastavení' }).click()
  await page.getByLabel('Odkaz na tabulku').fill(SHEET)
  await page.getByRole('button', { name: 'Načíst zboží z tabulky' }).click()
  await dlg(page).getByRole('button', { name: 'Načíst' }).click()
  await page.getByRole('link', { name: 'Inventury' }).click()
}

async function newSession(page: Page, name: string) {
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await dlg(page).getByLabel('Název', { exact: true }).fill(name)
  await dlg(page).getByRole('button', { name: 'Založit' }).click()
}

/** Types a code into the manual dialog — the same path a camera scan takes. */
async function scan(page: Page, code: string) {
  await page.getByRole('button', { name: 'Ručně' }).click()
  await dlg(page).getByLabel('Kód zboží').fill(code)
  await dlg(page).getByRole('button', { name: 'Započítat' }).click()
}

const CATALOG = ['"8594001020304","Mikina šedá M"', '"8594001020399","Tričko bílé"'].join('\n')

test('an unknown code can be pointed at goods already in the catalogue', async ({ page }) => {
  await page.goto('./')
  await loadCatalog(page, CATALOG)
  await newSession(page, 'Textil')

  // A second EAN on the same sweatshirt — a repack, or a code the sheet never listed.
  await scan(page, '4006381333931')
  await expect(dlg(page).getByRole('heading', { name: 'Neznámý kód' })).toBeVisible()
  await dlg(page).getByRole('tab', { name: 'Mám ho v katalogu' }).click()
  await dlg(page).getByRole('button', { name: /Mikina šedá M/ }).click()
  await expect(dlg(page)).toHaveCount(0)

  // One line, on the existing goods — not a second row called the same thing.
  await expect(page.getByText('1 položka · 1 kus')).toBeVisible()
  await expect(page.getByText('Mikina šedá M')).toBeVisible()

  // And it is remembered: the same code now counts without asking.
  await scan(page, '4006381333931')
  await expect(dlg(page)).toHaveCount(0)
  await expect(page.getByText('1 položka · 2 kusy')).toBeVisible()
})

/** The link is a fact about the goods, not about one stocktake. */
test('a linked code still works in the next stocktake', async ({ page }) => {
  await page.goto('./')
  await loadCatalog(page, CATALOG)
  await newSession(page, 'První')
  await scan(page, '4006381333931')
  await dlg(page).getByRole('tab', { name: 'Mám ho v katalogu' }).click()
  await dlg(page).getByRole('button', { name: /Mikina šedá M/ }).click()

  await page.getByRole('link', { name: 'Inventury' }).click()
  await newSession(page, 'Druhá')
  await scan(page, '4006381333931')

  await expect(dlg(page)).toHaveCount(0)
  await expect(page.getByText('Mikina šedá M')).toBeVisible()
  await expect(page.getByText('1 položka · 1 kus')).toBeVisible()
})

/**
 * The sheet is re-read whenever it changes, and it knows nothing about links made in an
 * aisle. If a reload wiped them the feature would quietly stop working a week later.
 */
test('re-reading the sheet does not undo a link', async ({ page }) => {
  await page.goto('./')
  await loadCatalog(page, CATALOG)
  await newSession(page, 'Textil')
  await scan(page, '4006381333931')
  await dlg(page).getByRole('tab', { name: 'Mám ho v katalogu' }).click()
  await dlg(page).getByRole('button', { name: /Mikina šedá M/ }).click()

  await loadCatalog(page, `${CATALOG}\n"8594001020400","Čepice"`)
  await page.getByText('Textil').click()
  await scan(page, '4006381333931')

  await expect(dlg(page)).toHaveCount(0)
  await expect(page.getByText('1 položka · 2 kusy')).toBeVisible()
})

test('search narrows the catalogue, and naming new goods still works', async ({ page }) => {
  await page.goto('./')
  await loadCatalog(page, CATALOG)
  await newSession(page, 'Textil')
  await scan(page, '4006381333931')

  await dlg(page).getByRole('tab', { name: 'Mám ho v katalogu' }).click()
  await dlg(page).getByLabel('Najdi zboží').fill('tričko')
  await expect(dlg(page).getByRole('button', { name: /Tričko bílé/ })).toBeVisible()
  await expect(dlg(page).getByRole('button', { name: /Mikina/ })).toBeHidden()

  await dlg(page).getByLabel('Najdi zboží').fill('nic takového')
  await expect(dlg(page).getByText('Nic takového v katalogu není')).toBeVisible()

  // The other way out is still there: these really are new goods.
  await dlg(page).getByRole('tab', { name: 'Nové zboží' }).click()
  await dlg(page).getByLabel('Název zboží').fill('Šála pletená')
  await dlg(page).getByRole('button', { name: 'Uložit a započítat' }).click()
  await expect(dlg(page)).toHaveCount(0)
  await expect(page.getByText('Šála pletená')).toBeVisible()
})

/** On a fresh phone there is nothing to link to — the choice would be a lie. */
test('with an empty catalogue the dialog just asks for a name', async ({ page }) => {
  await page.goto('./')
  await newSession(page, 'Prázdná')
  await scan(page, '8594001020304')

  await expect(dlg(page).getByRole('heading', { name: 'Neznámý kód' })).toBeVisible()
  await expect(dlg(page).getByRole('tab', { name: 'Mám ho v katalogu' })).toHaveCount(0)
  await expect(dlg(page).getByLabel('Název zboží')).toBeVisible()
})

/** A link the backup loses is a link the user makes twice. */
test('links survive a backup and restore', async ({ page, browser }, testInfo) => {
  await page.goto('./')
  await loadCatalog(page, CATALOG)
  await newSession(page, 'Textil')
  await scan(page, '4006381333931')
  await dlg(page).getByRole('tab', { name: 'Mám ho v katalogu' }).click()
  await dlg(page).getByRole('button', { name: /Mikina šedá M/ }).click()

  await page.getByRole('link', { name: 'Inventury' }).click()
  await page.getByRole('link', { name: 'Nastavení' }).click()
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Zálohovat' }).click(),
  ]).then(([d]) => d)
  const path = join(testInfo.outputDir, download.suggestedFilename())
  await download.saveAs(path)

  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL })
  const pc = await context.newPage()
  await pc.goto('./')
  await pc.getByRole('link', { name: 'Nastavení' }).click()
  await pc.getByLabel('Vybrat soubor se zálohou').setInputFiles(path)
  await dlg(pc).getByRole('button', { name: 'Načíst' }).click()
  await expect(pc.getByRole('link', { name: 'Inventury' })).toBeVisible()

  await pc.getByRole('link', { name: 'Inventury' }).click()
  await newSession(pc, 'Na druhém zařízení')
  await scan(pc, '4006381333931')

  // The restored device knows the link — no dialog, and it lands on the right goods.
  await expect(dlg(pc)).toHaveCount(0)
  await expect(pc.getByText('Mikina šedá M')).toBeVisible()
})

/** Forgetting goods must take their links with them, or they point at nothing. */
test('forgetting goods removes the codes linked to them', async ({ page }) => {
  await page.goto('./')
  await loadCatalog(page, CATALOG)
  await newSession(page, 'Textil')
  await scan(page, '4006381333931')
  await dlg(page).getByRole('tab', { name: 'Mám ho v katalogu' }).click()
  await dlg(page).getByRole('button', { name: /Mikina šedá M/ }).click()

  await page.getByRole('link', { name: 'Inventury' }).click()
  await page.getByRole('link', { name: 'Nastavení' }).click()
  await page.getByRole('button', { name: 'Zapomenout Mikina šedá M' }).click()
  await dlg(page).getByRole('button', { name: 'Zapomenout' }).click()

  await page.getByRole('link', { name: 'Inventury' }).click()
  await newSession(page, 'Potom')
  await scan(page, '4006381333931')

  // Unknown again — the app really does not know what this is any more.
  await expect(dlg(page).getByRole('heading', { name: 'Neznámý kód' })).toBeVisible()
})
