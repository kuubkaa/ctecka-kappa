import { expect, test, type Page } from '@playwright/test'
import { pdfText } from './pdf-text'

const dlg = (page: Page) => page.locator('dialog[open]')

async function newSession(page: Page, name?: string) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  if (name) await dlg(page).getByLabel('Název', { exact: true }).fill(name)
  await dlg(page).getByRole('button', { name: 'Založit' }).click()
}

async function addLoose(page: Page, name: string, qty: number) {
  await page.getByRole('button', { name: 'Bez kódu' }).click()
  await dlg(page).getByLabel('Název zboží').fill(name)
  await dlg(page).getByLabel('Počet kusů').fill(String(qty))
  await dlg(page).getByRole('button', { name: 'Přidat' }).click()
  await expect(dlg(page)).toHaveCount(0)
}

test('adds goods that have no barcode at all, with a quantity in one go', async ({ page }) => {
  await newSession(page)

  await addLoose(page, 'Jablka volně vážená', 37)
  await expect(page.getByText('1 položka · 37 kusů')).toBeVisible()
  await expect(page.getByText('Jablka volně vážená')).toBeVisible()

  // The synthetic id is an implementation detail — the user must never see it.
  await expect(page.getByText('bez čárového kódu')).toBeVisible()
  await expect(page.getByText(/bez-kodu:/)).toBeHidden()
})

test('re-adding the same loose goods tops up one line instead of opening a second', async ({
  page,
}) => {
  await newSession(page)
  await addLoose(page, 'Jablka volně', 10)
  // Different casing and stray spaces: the user is typing in a warehouse, and two
  // rows both saying "Jablka" on a signed protocol would be a defect.
  await addLoose(page, '  jablka VOLNĚ  ', 5)

  await expect(page.getByText('1 položka · 15 kusů')).toBeVisible()
  // Count the rows themselves: every row's +/- buttons also carry the goods' name,
  // so matching by name would count three things per line.
  await expect(page.locator('main ul > li')).toHaveCount(1)
  // The first spelling wins — the count merged into the existing line, not the other
  // way round, so the name the user first chose is the one on the protocol.
  await expect(page.getByText('Jablka volně', { exact: true })).toBeVisible()
})

test('loose goods still take part in the normal +/- and edit flow', async ({ page }) => {
  await newSession(page)
  await addLoose(page, 'Rohlíky rozbalené', 4)

  await page.getByRole('button', { name: 'Přidat Rohlíky rozbalené' }).click()
  await expect(page.getByText('1 položka · 5 kusů')).toBeVisible()

  await page.getByRole('button', { name: 'Rohlíky rozbalené' }).first().click()
  await dlg(page).getByLabel('Počet kusů').fill('120')
  await dlg(page).getByRole('button', { name: 'Uložit' }).click()
  await expect(page.getByText('1 položka · 120 kusů')).toBeVisible()
})

test('the protocol says "bez kódu", never the synthetic id', async ({ page }) => {
  await newSession(page, 'Inventura s volným zbožím')

  await addLoose(page, 'Jablka volně vážená', 37)
  await addLoose(page, 'Šťavnatá hruška ďábelská', 8)

  // A barcoded item alongside, so we can prove real codes still print.
  await page.getByRole('button', { name: 'Ručně' }).click()
  await dlg(page).getByLabel('Kód zboží').fill('8594001020304')
  await dlg(page).getByRole('button', { name: 'Započítat' }).click()
  await dlg(page).getByLabel('Název zboží').fill('Čokoláda hořká 70 %')
  await dlg(page).getByRole('button', { name: 'Uložit a započítat' }).click()

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Stáhnout předávací protokol/ }).click(),
  ]).then(([d]) => d)
  const text = await pdfText(await download.path())

  expect(text).toContain('Jablka volně vážená')
  expect(text).toContain('Šťavnatá hruška ďábelská')
  expect(text).toContain('bez kódu')

  // The whole point: a fabricated id on a signed document reads as a real barcode
  // and sends someone hunting the shelves for it.
  expect(text, 'synthetic id must never reach the protocol').not.toContain('bez-kodu:')
  expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)

  // Real barcodes are unaffected.
  expect(text).toContain('8594001020304')
  expect(text).toContain('Počet položek (druhů zboží): 3')
  expect(text).toContain('Celkem kusů')
})

test('loose goods are remembered for the next stocktake', async ({ page }) => {
  await newSession(page)
  await addLoose(page, 'Jablka volně', 3)

  await page.getByRole('link', { name: 'Inventury' }).click()
  await page.getByRole('link', { name: 'Nastavení' }).click()
  await expect(page.getByText('bez čárového kódu')).toBeVisible()

  await page.getByRole('link', { name: 'Inventury' }).click()
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await dlg(page).getByRole('button', { name: 'Založit' }).click()
  await addLoose(page, 'Jablka volně', 2)

  // Same catalog entry, fresh count — not a duplicate product.
  await expect(page.getByText('1 položka · 2 kusy')).toBeVisible()
})
