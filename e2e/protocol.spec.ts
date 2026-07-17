import { expect, test } from '@playwright/test'
import { pdfText } from './pdf-text'

type Page = import('@playwright/test').Page

/**
 * Every dialog stays mounted so it can animate, and several share field labels
 * ("Název zboží" appears in both Nové zboží and Upravit položku). Scoping to the
 * one that is actually open matches what the user can touch.
 */
const openDialog = (page: Page) => page.locator('dialog[open]')

async function addItem(page: Page, code: string, name: string) {
  await page.getByRole('button', { name: 'Ručně' }).click()
  await openDialog(page).getByLabel('Kód zboží').fill(code)
  await openDialog(page).getByRole('button', { name: 'Započítat' }).click()
  await openDialog(page).getByLabel('Název zboží').fill(name)
  await openDialog(page).getByRole('button', { name: 'Uložit a započítat' }).click()
  await expect(openDialog(page)).toHaveCount(0)
}

test('protocol renders Czech diacritics intact, in body and bold header alike', async ({
  page,
}) => {
  await page.goto('./')

  // ě č ř ů ť ď ň are the ones jsPDF's built-in fonts destroy — and they destroy
  // them silently, so this test exists to make that failure loud.
  const company = 'Žluťoučký kůň, s.r.o.'
  const sessionName = 'Inventura — září ěščřžýáíéúůťďň'
  const place = 'Sklad Příbram'

  await page.getByRole('link', { name: 'Nastavení' }).click()
  await page.getByLabel('Název firmy').fill(company)
  await page.getByLabel('Výchozí místo / sklad').fill(place)
  await page.getByLabel('Výchozí místo / sklad').blur()
  await expect(page.getByText('Uloženo')).toBeVisible()
  await page.getByRole('link', { name: 'Inventury' }).click()

  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await openDialog(page).getByLabel('Název', { exact: true }).fill(sessionName)
  await openDialog(page).getByLabel('Předávající').fill('Jiří Křížek')
  await openDialog(page).getByLabel('Přebírající').fill('Šárka Nováková')
  await openDialog(page).getByRole('button', { name: 'Založit' }).click()

  await addItem(page, '8594001020304', 'Šťavnatá hruška ďábelská')
  await addItem(page, '8594001020311', 'Čokoláda hořká 70 %')

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Stáhnout předávací protokol/ }).click(),
  ]).then(([d]) => d)

  expect(download.suggestedFilename()).toMatch(/\.pdf$/)
  const path = await download.path()
  const text = await pdfText(path)

  // Body text.
  expect(text).toContain('Předávací protokol')
  expect(text).toContain(company)
  expect(text).toContain(sessionName)
  expect(text).toContain(place)
  expect(text).toContain('Šťavnatá hruška ďábelská')
  expect(text).toContain('Čokoláda hořká 70 %')
  expect(text).toContain('Jiří Křížek')
  expect(text).toContain('Šárka Nováková')

  // Bold: autoTable renders headers bold, and a missing bold face makes jsPDF fall
  // back to Helvetica and mangle *only* the header — easy to miss by eye.
  expect(text).toContain('Kód zboží')
  expect(text).toContain('Název zboží')
  expect(text).toContain('Předávající')
  expect(text).toContain('Přebírající')

  // The specific corruption cp1252 produces, asserted directly so a regression
  // names itself instead of just failing a contains().
  expect(text).not.toContain('PYedávací')
  expect(text).not.toMatch(/P\s*Y/)

  // Summary and totals.
  expect(text).toContain('Celkem kusů')
  expect(text).toContain('Počet položek (druhů zboží): 2')
})

/**
 * Guards the nastiest bug found in this app: jsPDF truncates a string at the first
 * character its font lacks, with no error. A Czech-only font subset turned
 * "Müsli tyčinka ořechová" into "M" on a document people sign. Product names in a
 * Czech warehouse are routinely German or Slovak, so the font covers Latin-1 +
 * Latin Extended-A, and pdf.ts screens anything beyond it into a visible "?".
 */
test('foreign product names survive the protocol intact', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await openDialog(page).getByRole('button', { name: 'Založit' }).click()

  const names = [
    'Müsli tyčinka ořechová', // German umlaut — used to truncate to "M"
    'Jägermeister 0,7 l',
    'Slovenská ľalia ôsma', // used to drop ľ, then truncate at ô
    'Piwo Żywiec łagodne', // Polish
    'Crème brûlée dessert', // French
  ]
  for (const [i, name] of names.entries()) {
    await addItem(page, `859400102030${i}`, name)
  }

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Stáhnout předávací protokol/ }).click(),
  ]).then(([d]) => d)
  const text = await pdfText(await download.path())

  for (const name of names) {
    expect(text, `"${name}" must survive whole`).toContain(name)
  }
})

test('a name the font cannot draw degrades visibly, never silently', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await openDialog(page).getByRole('button', { name: 'Založit' }).click()
  // Cyrillic is beyond Latin Extended-A. It must not swallow the rest of the name.
  await addItem(page, '8594001020304', 'Vodka Наташа 0,5 l')

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Stáhnout předávací protokol/ }).click(),
  ]).then(([d]) => d)
  const text = await pdfText(await download.path())

  // Unrenderable characters become '?', and — crucially — the text after them lives.
  expect(text).toContain('Vodka ?????? 0,5 l')
})

test('counts repeated scans and lets the user correct quantities', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await page.getByRole('button', { name: 'Založit' }).click()

  await addItem(page, '8594001020304', 'Müsli tyčinka')
  await expect(page.getByText('1 položka · 1 kus')).toBeVisible()

  // Same code again: counts up rather than duplicating the line.
  await page.getByRole('button', { name: 'Ručně' }).click()
  await openDialog(page).getByLabel('Kód zboží').fill('8594001020304')
  await openDialog(page).getByRole('button', { name: 'Započítat' }).click()
  await expect(page.getByText('1 položka · 2 kusy')).toBeVisible()

  await page.getByRole('button', { name: 'Přidat Müsli tyčinka' }).click()
  await expect(page.getByText('1 položka · 3 kusy')).toBeVisible()

  await page.getByRole('button', { name: 'Ubrat Müsli tyčinka' }).click()
  await expect(page.getByText('1 položka · 2 kusy')).toBeVisible()

  // Typing an exact count is the realistic path for a full shelf.
  await page.getByRole('button', { name: 'Müsli tyčinka' }).first().click()
  await openDialog(page).getByLabel('Počet kusů').fill('48')
  await openDialog(page).getByRole('button', { name: 'Uložit' }).click()
  await expect(page.getByText('1 položka · 48 kusů')).toBeVisible()
})

test('a named barcode is remembered for the next stocktake', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await page.getByRole('button', { name: 'Založit' }).click()
  await addItem(page, '8594001020304', 'Rohlík tukový')

  await page.getByRole('link', { name: 'Inventury' }).click()
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await page.getByRole('button', { name: 'Založit' }).click()

  // Second stocktake, same code: no dialog this time — the catalog learned it.
  await page.getByRole('button', { name: 'Ručně' }).click()
  await openDialog(page).getByLabel('Kód zboží').fill('8594001020304')
  await openDialog(page).getByRole('button', { name: 'Započítat' }).click()

  await expect(openDialog(page)).toHaveCount(0)
  await expect(page.getByText('Rohlík tukový')).toBeVisible()
  await expect(page.getByText('1 položka · 1 kus')).toBeVisible()
})

test('deleting a stocktake asks first', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await openDialog(page).getByLabel('Název', { exact: true }).fill('Ke smazání')
  await openDialog(page).getByRole('button', { name: 'Založit' }).click()
  await addItem(page, '8594001020304', 'Něco')

  await page.getByRole('button', { name: 'Smazat inventuru' }).click()
  await expect(page.getByText(/Nenávratně smaže/)).toBeVisible()
  await openDialog(page).getByRole('button', { name: 'Zrušit' }).click()
  await expect(page.getByRole('heading', { name: 'Ke smazání' })).toBeVisible()

  await page.getByRole('button', { name: 'Smazat inventuru' }).click()
  await openDialog(page).getByRole('button', { name: 'Smazat', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Inventury' })).toBeVisible()
  await expect(page.getByText('Ke smazání')).toBeHidden()
})
