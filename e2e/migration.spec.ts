import { expect, test, type Page } from '@playwright/test'

/**
 * Moving to sync-safe keys meant a new database, because Dexie cannot change a
 * table's primary key in a version upgrade — and `++id` is exactly what had to go.
 *
 * So every existing user's data has to cross over on first load. Losing a month of
 * stocktakes to a schema change would be unforgivable and entirely invisible until
 * someone went looking, which is what these tests are for.
 */

/** Builds the pre-sync database exactly as the shipped version left it. */
async function seedLegacy(page: Page, seed: unknown) {
  await page.addInitScript((data: any) => {
    ;(window as any).__seeded = new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('ctecka-kappa', 1)
      req.onupgradeneeded = () => {
        const db = req.result
        db.createObjectStore('products', { keyPath: 'code' })
        const items = db.createObjectStore('items', { keyPath: 'id', autoIncrement: true })
        items.createIndex('[sessionId+code]', ['sessionId', 'code'])
        items.createIndex('sessionId', 'sessionId')
        const sessions = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true })
        sessions.createIndex('startedAt', 'startedAt')
        db.createObjectStore('settings', { keyPath: 'key' })
      }
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(['products', 'items', 'sessions', 'settings'], 'readwrite')
        for (const p of data.products) tx.objectStore('products').put(p)
        for (const s of data.sessions) tx.objectStore('sessions').put(s)
        for (const i of data.items) tx.objectStore('items').put(i)
        for (const s of data.settings) tx.objectStore('settings').put(s)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
  }, seed)
}

const LEGACY = {
  products: [
    { code: '8594001020304', name: 'Šťavnatá hruška ďábelská', createdAt: 1 },
    { code: '8594001020305', name: 'Müsli tyčinka ořechová', createdAt: 2 },
    { code: 'bez-kodu:abc-123', name: 'Jablka volně', createdAt: 3, noBarcode: true },
  ],
  sessions: [
    {
      id: 1,
      name: 'Červnová inventura',
      place: 'Sklad Příbram',
      handoverFrom: 'Jiří Křížek',
      handoverTo: 'Šárka Nováková',
      startedAt: 1000,
      closedAt: 2000,
    },
    {
      id: 2,
      name: 'Rozpočítaná',
      place: '',
      handoverFrom: '',
      handoverTo: '',
      startedAt: 3000,
    },
  ],
  items: [
    { id: 1, sessionId: 1, code: '8594001020304', qty: 12, updatedAt: 1100 },
    { id: 2, sessionId: 1, code: '8594001020305', qty: 7, updatedAt: 1200 },
    { id: 3, sessionId: 1, code: 'bez-kodu:abc-123', qty: 37, updatedAt: 1300 },
    { id: 4, sessionId: 2, code: '8594001020304', qty: 3, updatedAt: 3100 },
  ],
  settings: [{ key: 'app', company: 'Žluťoučký kůň, s.r.o.', defaultPlace: 'Sklad Příbram' }],
}

test('data from the pre-sync version survives the schema change', async ({ page }) => {
  await seedLegacy(page, LEGACY)
  await page.goto('./')
  await page.evaluate(() => (window as any).__seeded)
  await page.reload()

  await expect(page.getByText('Červnová inventura')).toBeVisible()
  await expect(page.getByText('Rozpočítaná')).toBeVisible()
  await expect(page.getByText('3 položky · 56 kusů')).toBeVisible()
  await expect(page.getByText('1 položka · 3 kusy')).toBeVisible()

  await page.getByText('Červnová inventura').click()
  await expect(page.getByText('Šťavnatá hruška ďábelská')).toBeVisible()
  await expect(page.getByText('Müsli tyčinka ořechová')).toBeVisible()
  await expect(page.getByText('Jablka volně')).toBeVisible()
  // Loose goods must stay loose, not resurface as a fake barcode.
  await expect(page.getByText('bez čárového kódu')).toBeVisible()
  await expect(page.getByText('Sklad Příbram')).toBeVisible()

  // Settings came across too, or the next protocol prints without a company.
  await page.getByRole('link', { name: 'Inventury' }).click()
  await page.getByRole('link', { name: 'Nastavení' }).click()
  await expect(page.getByLabel('Název firmy')).toHaveValue('Žluťoučký kůň, s.r.o.')
})

test('session ids become globally unique, so two devices cannot collide', async ({ page }) => {
  await seedLegacy(page, LEGACY)
  await page.goto('./')
  await page.evaluate(() => (window as any).__seeded)
  await page.reload()
  await expect(page.getByText('Červnová inventura')).toBeVisible()

  const ids = await page.evaluate(async () => {
    const open = indexedDB.open('ctecka-kappa-sync')
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result)
      open.onerror = () => rej(open.error)
    })
    const rows: any[] = await new Promise((res, rej) => {
      const req = db.transaction('sessions').objectStore('sessions').getAll()
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    db.close()
    return rows.map((r) => r.id)
  })

  expect(ids).toHaveLength(2)
  for (const id of ids) {
    expect(typeof id, 'a per-device counter would collide across devices').toBe('string')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
  }
  expect(new Set(ids).size).toBe(2)
})

test('migrating twice does not duplicate anything', async ({ page }) => {
  await seedLegacy(page, LEGACY)
  await page.goto('./')
  await page.evaluate(() => (window as any).__seeded)
  await page.reload()
  await expect(page.getByText('Červnová inventura')).toBeVisible()

  // Every subsequent launch re-runs the migration check.
  await page.reload()
  await page.reload()

  await expect(page.getByText('Červnová inventura')).toHaveCount(1)
  await expect(page.getByText('Rozpočítaná')).toHaveCount(1)
  await expect(page.getByText('3 položky · 56 kusů')).toBeVisible()
})

test('the old database is left intact as a fallback', async ({ page }) => {
  await seedLegacy(page, LEGACY)
  await page.goto('./')
  await page.evaluate(() => (window as any).__seeded)
  await page.reload()
  await expect(page.getByText('Červnová inventura')).toBeVisible()

  // Deleting a user's only copy of their stocktakes to reclaim a few hundred kB
  // would be a terrible trade. The old data stays put.
  const names = await page.evaluate(() => indexedDB.databases().then((d) => d.map((x) => x.name)))
  expect(names).toContain('ctecka-kappa')
  expect(names).toContain('ctecka-kappa-sync')
})

test('a fresh install with no old data just works', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText('Zatím žádná inventura')).toBeVisible()
  await page.getByRole('button', { name: 'Nová inventura' }).click()
  await page.locator('dialog[open]').getByRole('button', { name: 'Založit' }).click()
  await expect(page.getByText('Zatím nic naskenováno')).toBeVisible()
})
