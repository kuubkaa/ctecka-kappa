import Dexie, { add, type EntityTable } from 'dexie'

/** A barcode the user has named. The catalog builds itself up as they scan. */
export interface Product {
  /**
   * The barcode — or, for goods that have none, a synthetic internal id. Every
   * table is keyed on this, so it cannot be empty. Use `isNoBarcode()` rather than
   * showing it: a made-up id printed on a signed protocol looks like a real barcode
   * and would send someone hunting for it on the shelf.
   */
  code: string
  name: string
  createdAt: number
  /** Loose or unlabelled goods — weighed produce, opened cartons, own production. */
  noBarcode?: boolean
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

/**
 * Marks a code as a stand-in rather than a real barcode. Everything is keyed on
 * `code`, so unlabelled goods still need one — but it must never be shown.
 */
const NO_BARCODE_PREFIX = 'bez-kodu:'

export const isNoBarcode = (code: string) => code.startsWith(NO_BARCODE_PREFIX)

/** Matches "Jablka " and "jablka" as the same goods — the user is typing in a warehouse. */
const nameKey = (name: string) => name.trim().toLocaleLowerCase('cs')

export type ScanOutcome =
  | { kind: 'counted'; product: Product; qty: number }
  | { kind: 'unknown'; code: string }

/**
 * Records one scan. Unknown codes are reported back rather than guessed at —
 * the UI asks the user to name them, which is how the catalog gets built.
 *
 * The count is incremented with Dexie's `add()`, never by reading a number and
 * writing back a bigger one. That distinction is invisible on one device — the
 * transaction covers it — but decides correctness once two devices sync:
 *
 *     phone counts 50 offline    PC sets the count to 3
 *     read-modify-write -> 50 or 3, never 53
 *     add(1) x50        -> replayed against current state -> 53
 *
 * A wrong count is silent, plausible, and ends up on a protocol someone signs.
 */
export async function recordScan(sessionId: number, code: string): Promise<ScanOutcome> {
  return db.transaction('rw', db.products, db.items, async () => {
    const product = await db.products.get(code)
    if (!product) return { kind: 'unknown', code }

    const existing = await db.items.where({ sessionId, code }).first()
    if (existing) {
      await db.items.update(existing.id, { qty: add(1), updatedAt: Date.now() })
      // Re-read rather than compute: `add(1)` is an instruction, not a value, so
      // the resulting number is the database's to decide, not ours to guess.
      const qty = (await db.items.get(existing.id))?.qty ?? existing.qty + 1
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
      await db.items.update(existing.id, { qty: add(1), updatedAt: Date.now() })
    } else {
      await db.items.add({ sessionId, code, qty: 1, updatedAt: Date.now() } as Item)
    }
  })
}

/**
 * Adds goods that carry no barcode at all — loose produce, opened cartons, own
 * production. Takes a quantity because you weigh or eyeball these in one go rather
 * than beeping them one at a time.
 *
 * Re-adding the same name tops up the existing line instead of opening a second one:
 * two rows both saying "Jablka" on a protocol someone signs is a defect, and matching
 * on name is what the user means by typing the same thing twice.
 */
export async function addWithoutBarcode(
  sessionId: number,
  name: string,
  qty: number,
): Promise<void> {
  const clean = name.trim()
  if (!clean || !Number.isFinite(qty) || qty <= 0) return

  await db.transaction('rw', db.products, db.items, async () => {
    const key = nameKey(clean)
    // Full scan, but the catalog is hundreds of rows and this is a typed interaction,
    // not the scan hot path.
    const existing = await db.products
      .filter((p) => !!p.noBarcode && nameKey(p.name) === key)
      .first()

    const code = existing?.code ?? `${NO_BARCODE_PREFIX}${crypto.randomUUID()}`
    if (!existing) {
      await db.products.add({ code, name: clean, createdAt: Date.now(), noBarcode: true })
    }

    const item = await db.items.where({ sessionId, code }).first()
    if (item) {
      await db.items.update(item.id, { qty: add(Math.trunc(qty)), updatedAt: Date.now() })
    } else {
      await db.items.add({ sessionId, code, qty: Math.trunc(qty), updatedAt: Date.now() } as Item)
    }
  })
}

/**
 * Nudges a count by ±1 (the list's + / − buttons).
 *
 * Takes a delta, not a target: computing `line.qty + 1` in the UI and writing the
 * result back is the same read-modify-write that loses counts across devices, just
 * with a longer round trip through React.
 */
export async function bumpQty(itemId: number, delta: number): Promise<void> {
  await db.transaction('rw', db.items, async () => {
    await db.items.update(itemId, { qty: add(delta), updatedAt: Date.now() })
    const now = await db.items.get(itemId)
    if (now && now.qty <= 0) await db.items.delete(itemId)
  })
}

/**
 * Sets a count outright — "there are 48 on the shelf".
 *
 * Deliberately absolute, unlike `bumpQty`: the user is stating a fact they just
 * counted, so their number must win over anything a device counted earlier.
 */
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
  /** Callers must render a placeholder rather than `code` when this is true. */
  noBarcode: boolean
}

export async function getLines(sessionId: number): Promise<Line[]> {
  const items = await db.items.where({ sessionId }).toArray()
  const products = await db.products.bulkGet(items.map((i) => i.code))
  return items
    .map((item, idx) => {
      const product = products[idx]
      const noBarcode = product?.noBarcode ?? isNoBarcode(item.code)
      return {
        itemId: item.id,
        code: item.code,
        // Falling back to `code` covers a product the user chose to forget — but for
        // unlabelled goods that code is a synthetic id nobody should ever read.
        name: product?.name ?? (noBarcode ? 'Zboží bez čárového kódu' : item.code),
        qty: item.qty,
        noBarcode,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
}
