import { expect, test, type Page } from '@playwright/test'

/**
 * Loading the product catalog from a Google Sheet.
 *
 * Google is stubbed rather than called: the suite has to pass offline and on a plane,
 * and a test that depends on a live shared spreadsheet fails for reasons that have
 * nothing to do with this app. What is NOT stubbed is the contract — the shapes below
 * are the ones measured against the real gviz endpoint (200 + text/csv on success,
 * 404 + text/html for a sheet that isn't shared, and 200 + the *first* tab whenever
 * Google doesn't recognise the gid).
 */

const SHEET =
  'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0'

const dlg = (page: Page) => page.locator('dialog[open]')

/** The catalog section's own live region — Backup has one too, and both say "Načteno". */
const catalogStatus = (page: Page) =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Zboží z tabulky', exact: true }) })
    .getByRole('status')

async function stubSheet(
  page: Page,
  body: string,
  init: { status?: number; contentType?: string } = {},
) {
  await page.route('https://docs.google.com/**/gviz/**', (route) =>
    route.fulfill({
      status: init.status ?? 200,
      contentType: init.contentType ?? 'text/csv; charset=utf-8',
      body,
    }),
  )
}

async function openSettings(page: Page) {
  const back = page.getByRole('link', { name: 'Inventury' })
  if (await back.isVisible()) await back.click()
  await page.getByRole('link', { name: 'Nastavení' }).click()
}

async function loadSheet(page: Page, url = SHEET) {
  await page.getByLabel('Odkaz na tabulku').fill(url)
  await page.getByRole('button', { name: 'Načíst zboží z tabulky' }).click()
}

async function newSession(page: Page, name: string) {
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await dlg(page).getByLabel('Název', { exact: true }).fill(name)
  await dlg(page).getByRole('button', { name: 'Založit' }).click()
}

/** The point of the whole feature: a preset code counts without asking for a name. */
test('preset goods are counted straight away, without asking what they are', async ({ page }) => {
  await stubSheet(
    page,
    [
      '"Čárový kód","Název"',
      '"8594001020304","Müsli tyčinka ořechová"',
      '"8594001020399","Žluté jablko"',
    ].join('\n'),
  )

  await page.goto('./')
  await openSettings(page)
  await loadSheet(page)

  await expect(dlg(page).getByRole('heading', { name: 'Sedí to?' })).toBeVisible()
  await expect(dlg(page).getByText('Müsli tyčinka ořechová')).toBeVisible()
  await dlg(page).getByRole('button', { name: 'Načíst' }).click()
  await expect(catalogStatus(page)).toContainText('2 druhy nového zboží')

  await page.getByRole('link', { name: 'Inventury' }).click()
  await newSession(page, 'Inventura z tabulky')
  await page.getByRole('button', { name: 'Ručně' }).click()
  await dlg(page).getByLabel('Čárový kód').fill('8594001020304')
  await dlg(page).getByRole('button', { name: 'Započítat' }).click()

  // No "what is this?" prompt — the sheet already answered.
  await expect(dlg(page)).toHaveCount(0)
  await expect(page.getByText('Müsli tyčinka ořechová')).toBeVisible()
  await expect(page.getByText('1 položka · 1 kus')).toBeVisible()
})

/**
 * Google serves the first tab, HTTP 200, whenever it doesn't recognise the gid — so
 * "wrong tab" arrives looking exactly like success. The preview is the only thing that
 * can catch it, which means cancelling must actually leave the catalog untouched.
 */
test('the preview can be refused, and refusing imports nothing', async ({ page }) => {
  await stubSheet(page, ['"Student Name","Gender"', '"Alexandra","Female"'].join('\n'))

  await page.goto('./')
  await openSettings(page)
  await loadSheet(page)

  // The user sees somebody else's spreadsheet and stops.
  await expect(dlg(page).getByText('Alexandra')).toBeVisible()
  await dlg(page).getByRole('button', { name: 'Zrušit' }).click()

  await expect(dlg(page)).toHaveCount(0)
  await expect(page.getByText('Zatím nic naučeného')).toBeVisible()
  await expect(page.getByText('Alexandra')).toBeHidden()
})

test('a sheet that is not shared says how to share it', async ({ page }) => {
  await stubSheet(page, '<!DOCTYPE html><html><body>Sign in</body></html>', {
    status: 404,
    contentType: 'text/html; charset=utf-8',
  })

  await page.goto('./')
  await openSettings(page)
  await loadSheet(page)

  await expect(catalogStatus(page)).toContainText('není sdílená')
  await expect(dlg(page)).toHaveCount(0)
})

/**
 * A not-shared sheet can also come back as a login page with HTTP 200. Parsed as CSV
 * that becomes a catalog full of HTML, so the content type has to be what decides.
 */
test('a login page returned as HTTP 200 is refused, not parsed into goods', async ({ page }) => {
  await stubSheet(page, '<!DOCTYPE html><html><body>Sign in to continue</body></html>', {
    contentType: 'text/html; charset=utf-8',
  })

  await page.goto('./')
  await openSettings(page)
  await loadSheet(page)

  await expect(catalogStatus(page)).toContainText('není sdílená')
  await expect(dlg(page)).toHaveCount(0)
})

/**
 * Barcodes left in a number-formatted column lose their leading digits. The scan would
 * simply never match, leaving the user re-typing names with no idea why — so the app
 * refuses the sheet and names the fix instead of importing the wreckage.
 */
test('barcodes Google turned into numbers are refused, with the fix spelled out', async ({
  page,
}) => {
  await stubSheet(page, ['"Kód","Název"', '"8,59400E+12","Müsli tyčinka"'].join('\n'))

  await page.goto('./')
  await openSettings(page)
  await loadSheet(page)

  await expect(catalogStatus(page)).toContainText('Prostý text')
  await expect(dlg(page)).toHaveCount(0)
  await expect(page.getByText('Zatím nic naučeného')).toBeVisible()
})

test('a link that is not a Google sheet is refused before anything is fetched', async ({
  page,
}) => {
  await page.goto('./')
  await openSettings(page)
  await loadSheet(page, 'https://example.com/muj-seznam')

  await expect(catalogStatus(page)).toContainText('není odkaz na Google tabulku')
})

/**
 * A header only falls out on its own if it doesn't look like a code — and "EAN-13"
 * looks exactly like one. It is also the barcode standard's real name, so it is a
 * header people actually write. Getting this wrong invents a product called "Název".
 */
test('a header row is dropped whatever it is called, even "EAN-13"', async ({ page }) => {
  await stubSheet(
    page,
    ['"EAN-13","Název zboží"', '"8594001020304","Müsli tyčinka ořechová"'].join('\n'),
  )

  await page.goto('./')
  await openSettings(page)
  await loadSheet(page)

  await expect(dlg(page).getByText('1 druh zboží')).toBeVisible()
  await expect(dlg(page).getByText('Müsli tyčinka ořechová')).toBeVisible()
  // The header did not become goods called "Název zboží".
  await expect(dlg(page).getByText('Název zboží')).toBeHidden()
  await dlg(page).getByRole('button', { name: 'Načíst' }).click()
  await expect(catalogStatus(page)).toContainText('1 druh nového zboží')
})

/** Sheets without a header row are just as valid — row 1 is goods, not a label. */
test('a sheet with no header row keeps its first line', async ({ page }) => {
  await stubSheet(
    page,
    ['"8594001020304","Müsli tyčinka"', '"8594001020399","Žluté jablko"'].join('\n'),
  )

  await page.goto('./')
  await openSettings(page)
  await loadSheet(page)

  await expect(dlg(page).getByText('2 druhy zboží')).toBeVisible()
  await expect(dlg(page).getByText('Müsli tyčinka')).toBeVisible()
})

/** Paste once, use forever — the link is miserable to type on a phone. */
test('the link is remembered, so the next load is one button', async ({ page }) => {
  await stubSheet(page, '"8594001020304","Müsli tyčinka"')

  await page.goto('./')
  await openSettings(page)
  await page.getByLabel('Odkaz na tabulku').fill(SHEET)
  await page.getByLabel('Odkaz na tabulku').blur()

  await page.reload()
  await expect(page.getByLabel('Odkaz na tabulku')).toHaveValue(SHEET)
  await page.getByRole('button', { name: 'Načíst zboží z tabulky' }).click()
  await expect(dlg(page).getByText('Müsli tyčinka')).toBeVisible()
})

/**
 * The sheet is the list the user maintains on purpose, so it must be able to correct a
 * name typed on a phone in an aisle — but it must never touch what was counted.
 */
test('the sheet fixes a name without disturbing the count', async ({ page }) => {
  await stubSheet(page, ['"8594001020304","Müsli tyčinka ořechová"'].join('\n'))

  await page.goto('./')
  await newSession(page, 'Rozpočítaná')
  await page.getByRole('button', { name: 'Ručně' }).click()
  await dlg(page).getByLabel('Čárový kód').fill('8594001020304')
  await dlg(page).getByRole('button', { name: 'Započítat' }).click()
  await dlg(page).getByLabel('Název zboží').fill('musli')
  await dlg(page).getByRole('button', { name: 'Uložit a započítat' }).click()
  await page.getByRole('button', { name: 'Ručně' }).click()
  await dlg(page).getByLabel('Čárový kód').fill('8594001020304')
  await dlg(page).getByRole('button', { name: 'Započítat' }).click()
  await expect(page.getByText('1 položka · 2 kusy')).toBeVisible()

  await openSettings(page)
  await loadSheet(page)
  await dlg(page).getByRole('button', { name: 'Načíst' }).click()
  await expect(catalogStatus(page)).toContainText('1 přejmenovaného')

  await page.getByRole('link', { name: 'Inventury' }).click()
  await page.getByText('Rozpočítaná').click()
  await expect(page.getByText('Müsli tyčinka ořechová')).toBeVisible()
  // The rename is a rename, not a reset.
  await expect(page.getByText('1 položka · 2 kusy')).toBeVisible()
})
