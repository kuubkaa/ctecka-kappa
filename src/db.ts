import Dexie, { type EntityTable } from 'dexie'

/** A barcode the user has named. The catalog builds itself up as they scan. */
export interface Product {
  code: string
  name: string
  createdAt: number
}

/** One stocktake — opened, counted into, then closed and exported. */
export interface Session {
  id: number
  name: string
  place: string
  handoverFrom: string
  handoverTo: string
  startedAt: number
  closedAt?: number
}

/** How many of one product were counted in one session. */
export interface Item {
  id: number
  sessionId: number
  code: string
  qty: number
  updatedAt: number
}

export interface Settings {
  key: 'app'
  company: string
  defaultPlace: string
}

const db = new Dexie('ctecka-kappa') as Dexie & {
  products: EntityTable<Product, 'code'>
  sessions: EntityTable<Session, 'id'>
  items: EntityTable<Item, 'id'>
  settings: EntityTable<Settings, 'key'>
}

db.version(1).stores({
  products: 'code, name',
  // [sessionId+code] is the hot path: every scan looks a row up by it.
  items: '++id, [sessionId+code], sessionId',
  sessions: '++id, startedAt',
  settings: 'key',
})

export { db }

export type ScanOutcome =
  | { kind: 'counted'; product: Product; qty: number }
  | { kind: 'unknown'; code: string }

/**
 * Records one scan. Unknown codes are reported back rather than guessed at —
 * the UI asks the user to name them, which is how the catalog gets built.
 *
 * Runs in a transaction because a fast scanner can fire the same code twice
 * before the first read-modify-write commits, which would lose a count.
 */
export async function recordScan(sessionId: number, code: string): Promise<ScanOutcome> {
  return db.transaction('rw', db.products, db.items, async () => {
    const product = await db.products.get(code)
    if (!product) return { kind: 'unknown', code }

    const existing = await db.items.where({ sessionId, code }).first()
    if (existing) {
      const qty = existing.qty + 1
      await db.items.update(existing.id, { qty, updatedAt: Date.now() })
      return { kind: 'counted', product, qty }
    }
    await db.items.add({ sessionId, code, qty: 1, updatedAt: Date.now() } as Item)
    return { kind: 'counted', product, qty: 1 }
  })
}

/** Names a new barcode and counts it in one go — the answer to a 'unknown' outcome. */
export async function nameAndCount(sessionId: number, code: string, name: string): Promise<void> {
  await db.transaction('rw', db.products, db.items, async () => {
    await db.products.put({ code, name: name.trim(), createdAt: Date.now() })
    const existing = await db.items.where({ sessionId, code }).first()
    if (existing) {
      await db.items.update(existing.id, { qty: existing.qty + 1, updatedAt: Date.now() })
    } else {
      await db.items.add({ sessionId, code, qty: 1, updatedAt: Date.now() } as Item)
    }
  })
}

export async function setQty(itemId: number, qty: number): Promise<void> {
  if (qty <= 0) {
    await db.items.delete(itemId)
    return
  }
  await db.items.update(itemId, { qty, updatedAt: Date.now() })
}

export async function renameProduct(code: string, name: string): Promise<void> {
  await db.products.update(code, { name: name.trim() })
}

export async function createSession(input: Omit<Session, 'id' | 'startedAt'>): Promise<number> {
  return db.sessions.add({ ...input, startedAt: Date.now() } as Session)
}

export async function deleteSession(sessionId: number): Promise<void> {
  await db.transaction('rw', db.sessions, db.items, async () => {
    await db.items.where({ sessionId }).delete()
    await db.sessions.delete(sessionId)
  })
}

export async function getSettings(): Promise<Settings> {
  return (
    (await db.settings.get('app')) ?? { key: 'app', company: '', defaultPlace: '' }
  )
}

export async function saveSettings(patch: Partial<Omit<Settings, 'key'>>): Promise<void> {
  const current = await getSettings()
  await db.settings.put({ ...current, ...patch, key: 'app' })
}

/** A session's counted lines, joined to product names, sorted for human reading. */
export interface Line {
  itemId: number
  code: string
  name: string
  qty: number
}

export async function getLines(sessionId: number): Promise<Line[]> {
  const items = await db.items.where({ sessionId }).toArray()
  const products = await db.products.bulkGet(items.map((i) => i.code))
  return items
    .map((item, idx) => ({
      itemId: item.id,
      code: item.code,
      name: products[idx]?.name ?? item.code,
      qty: item.qty,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
}
