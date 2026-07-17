import Dexie, { add, type EntityTable, type Table } from 'dexie'

/**
 * The app does not sync — the backup file is how data moves between devices. The
 * schema is nonetheless sync-safe, and stays that way:
 *
 * 1. NO AUTO-INCREMENT KEYS. `++id` counts from 1 on every device, so two devices
 *    both mint "session 1" for different stocktakes and any merge fuses them. This
 *    is not hypothetical here: importing a backup onto a second device is exactly
 *    that merge.
 *
 * 2. ITEMS ARE KEYED BY [sessionId+code], NOT BY A GENERATED ID. Identity is what
 *    the row actually is: this product, in this stocktake. With a generated id the
 *    same barcode can occupy two rows and the count silently splits across them.
 *
 * 3. `products.code` STAYS THE PRIMARY KEY. A barcode is globally unique by
 *    construction, so the same goods really are the same row.
 *
 * Counts are also incremented with `add()` rather than read-modify-write — see
 * recordScan. That is what a sync backend would need, and it costs nothing to keep.
 */
const DB_NAME = 'ctecka-kappa-sync'
/** The pre-sync database. Read once to migrate, then left untouched as a fallback. */
const LEGACY_DB_NAME = 'ctecka-kappa'

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
  /** Globally unique, not a per-device counter. See schema note 1. */
  id: string
  name: string
  place: string
  handoverFrom: string
  handoverTo: string
  startedAt: number
  closedAt?: number
}

/** How many of one product were counted in one session. Keyed by [sessionId+code]. */
export interface Item {
  sessionId: string
  code: string
  qty: number
  updatedAt: number
}

/**
 * A second code for goods that are already in the catalog.
 *
 * Scanning something the sheet doesn't list has two different causes, and they need
 * different answers: goods nobody has named yet (name them — a new Product), and goods
 * that are in the catalog under another code (link them — this).
 *
 * A separate table rather than editing the product, for two reasons. `products.code` is
 * the primary key and `items` is keyed on it, so re-coding a product would strand every
 * count already recorded against it. And the sheet is re-read regularly: it would put
 * the original code straight back, silently undoing the link.
 */
export interface Alias {
  /** The scanned code — a barcode, so globally unique. See schema note 3. */
  code: string
  /** The `products.code` this stands for. */
  productCode: string
  createdAt: number
}

export interface Settings {
  key: 'app'
  company: string
  defaultPlace: string
  /** When a backup was last taken. Drives the reminder — see needsBackup(). */
  lastBackupAt?: number
  /** Google Sheet the catalog is loaded from. See lib/catalog.ts. */
  catalogUrl?: string
  /** When that sheet was last read, so the user can tell fresh from stale. */
  catalogLoadedAt?: number
}

const db = new Dexie(DB_NAME) as Dexie & {
  products: EntityTable<Product, 'code'>
  sessions: EntityTable<Session, 'id'>
  items: Table<Item, [string, string]>
  settings: EntityTable<Settings, 'key'>
  aliases: EntityTable<Alias, 'code'>
}

db.version(1).stores({
  products: 'code, name',
  // Compound natural primary key — see schema note 2. `sessionId` stays indexed so
  // a stocktake's lines can be listed without scanning the table.
  items: '[sessionId+code], sessionId',
  sessions: 'id, startedAt',
  settings: 'key',
})

// Version 2 rather than editing version 1: the shipped app already created v1 on
// real devices, and Dexie decides what to upgrade by diffing the declared versions.
// Rewriting history in place would leave those databases disagreeing with the code.
db.version(2).stores({
  // updatedAt indexed so the backup reminder can ask "anything newer than the last
  // backup?" without walking every row.
  items: '[sessionId+code], sessionId, updatedAt',
})

// Version 3 adds the alias table. Additive only — Dexie leaves the other stores alone,
// and a device that never links a code simply carries an empty table.
db.version(3).stores({
  // `productCode` indexed so a product's aliases can be found without a table scan —
  // needed when goods are forgotten, so the links don't outlive them.
  aliases: 'code, productCode',
})

export { db }

/** Item keys are a pair; React and Maps want one string. */
export const itemKey = (sessionId: string, code: string) => `${sessionId}\u0000${code}`

export function newId(): string {
  return crypto.randomUUID()
}

/**
 * Marks a code as a stand-in rather than a real barcode. Everything is keyed on
 * `code`, so unlabelled goods still need one — but it must never be shown.
 */
const NO_BARCODE_PREFIX = 'bez-kodu:'

export const isNoBarcode = (code: string) => code.startsWith(NO_BARCODE_PREFIX)

/** Matches "Jablka " and "jablka" as the same goods — the user is typing in a warehouse. */
const nameKey = (name: string) => name.trim().toLocaleLowerCase('cs')

/**
 * Matches "311283-194-M" with "311283-194-m" — the same goods, one line.
 *
 * Case never came up while codes were EANs: barcodes are digits. Internal codes in a
 * QR are not, and the manual fallback — the one for when a label is damaged — is
 * somebody thumbing a phone keyboard in an aisle. Same reasoning as nameKey: two rows
 * for one product on a protocol someone signs is a defect.
 *
 * Only ever a lookup key. The stored `code` keeps the case it arrived with, because
 * it is the primary key and `items` is keyed on it.
 */
export const codeKey = (code: string) => code.trim().toLocaleUpperCase('cs')

/**
 * The product a scanned or typed code refers to.
 *
 * Exact hit first, so the common path is a primary-key get. Everything after it only
 * runs on a miss — which already stops to ask the user a question, so a walk over a few
 * hundred rows is invisible beside that dialog.
 *
 * The catalog is consulted before the aliases: if the sheet has since claimed this code
 * for real goods, the sheet is the list the user maintains on purpose and wins over a
 * link made in an aisle months ago.
 */
async function findProduct(code: string): Promise<Product | undefined> {
  const exact = await db.products.get(code)
  if (exact) return exact

  const key = codeKey(code)
  const sameCode = await db.products.filter((p) => codeKey(p.code) === key).first()
  if (sameCode) return sameCode

  const alias =
    (await db.aliases.get(code)) ?? (await db.aliases.filter((a) => codeKey(a.code) === key).first())
  // A dangling alias — its goods were forgotten — reads as an unknown code, which is
  // exactly right: the app genuinely no longer knows what this is.
  return alias ? db.products.get(alias.productCode) : undefined
}

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
export async function recordScan(sessionId: string, code: string): Promise<ScanOutcome> {
  // `aliases` is in the transaction because findProduct reads it — Dexie throws on any
  // table touched outside the declared set.
  return db.transaction('rw', db.products, db.items, db.aliases, async () => {
    const product = await findProduct(code)
    if (!product) return { kind: 'unknown', code }

    // Count against the *stored* code, not the one that came in. They differ only in
    // case, and using the incoming one would open a second line for one product.
    const key = product.code
    const existing = await db.items.get([sessionId, key])
    if (existing) {
      await db.items.update([sessionId, key], { qty: add(1), updatedAt: Date.now() })
      // Re-read rather than compute: `add(1)` is an instruction, not a value, so
      // the resulting number is the database's to decide, not ours to guess.
      const qty = (await db.items.get([sessionId, key]))?.qty ?? existing.qty + 1
      return { kind: 'counted', product, qty }
    }
    await db.items.add({ sessionId, code: key, qty: 1, updatedAt: Date.now() })
    return { kind: 'counted', product, qty: 1 }
  })
}

/** Names a new barcode and counts it in one go — the answer to a 'unknown' outcome. */
export async function nameAndCount(sessionId: string, code: string, name: string): Promise<void> {
  await db.transaction('rw', db.products, db.items, async () => {
    await db.products.put({ code, name: name.trim(), createdAt: Date.now() })
    const existing = await db.items.get([sessionId, code])
    if (existing) {
      await db.items.update([sessionId, code], { qty: add(1), updatedAt: Date.now() })
    } else {
      await db.items.add({ sessionId, code, qty: 1, updatedAt: Date.now() })
    }
  })
}

/**
 * Points an unknown code at goods already in the catalog, and counts it — the other
 * answer to an 'unknown' outcome, when the goods are known but this code isn't.
 *
 * The count lands on the existing product, so the stocktake keeps one line for one
 * product however many codes end up pointing at it.
 */
export async function linkAndCount(
  sessionId: string,
  code: string,
  productCode: string,
): Promise<void> {
  const clean = code.trim()
  if (!clean) return
  await db.transaction('rw', db.products, db.items, db.aliases, async () => {
    // Refuse to link to goods that aren't there: a dangling alias would quietly behave
    // like an unknown code and look like the link never happened.
    if (!(await db.products.get(productCode))) return
    await db.aliases.put({ code: clean, productCode, createdAt: Date.now() })

    const existing = await db.items.get([sessionId, productCode])
    if (existing) {
      await db.items.update([sessionId, productCode], { qty: add(1), updatedAt: Date.now() })
    } else {
      await db.items.add({ sessionId, code: productCode, qty: 1, updatedAt: Date.now() })
    }
  })
}

/** Codes linked to a product, so the user can see what a "forget" would take with it. */
export async function aliasesOf(productCode: string): Promise<Alias[]> {
  return db.aliases.where({ productCode }).toArray()
}

/**
 * Forgets goods and every code pointing at them.
 *
 * The aliases have to go too: left behind they would point at nothing, and if the sheet
 * later reused the code for something else the stale link would be waiting.
 */
export async function forgetProduct(productCode: string): Promise<void> {
  await db.transaction('rw', db.products, db.aliases, async () => {
    await db.aliases.where({ productCode }).delete()
    await db.products.delete(productCode)
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
  sessionId: string,
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

    const code = existing?.code ?? `${NO_BARCODE_PREFIX}${newId()}`
    if (!existing) {
      await db.products.add({ code, name: clean, createdAt: Date.now(), noBarcode: true })
    }

    const item = await db.items.get([sessionId, code])
    if (item) {
      await db.items.update([sessionId, code], {
        qty: add(Math.trunc(qty)),
        updatedAt: Date.now(),
      })
    } else {
      await db.items.add({ sessionId, code, qty: Math.trunc(qty), updatedAt: Date.now() })
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
export async function bumpQty(sessionId: string, code: string, delta: number): Promise<void> {
  await db.transaction('rw', db.items, async () => {
    await db.items.update([sessionId, code], { qty: add(delta), updatedAt: Date.now() })
    const now = await db.items.get([sessionId, code])
    if (now && now.qty <= 0) await db.items.delete([sessionId, code])
  })
}

/**
 * Sets a count outright — "there are 48 on the shelf".
 *
 * Deliberately absolute, unlike `bumpQty`: the user is stating a fact they just
 * counted, so their number must win over anything a device counted earlier.
 */
export async function setQty(sessionId: string, code: string, qty: number): Promise<void> {
  if (qty <= 0) {
    await db.items.delete([sessionId, code])
    return
  }
  await db.items.update([sessionId, code], { qty, updatedAt: Date.now() })
}

export async function renameProduct(code: string, name: string): Promise<void> {
  await db.products.update(code, { name: name.trim() })
}

export interface CatalogImportResult {
  added: number
  renamed: number
  unchanged: number
}

/**
 * Loads a catalog read from the user's Google Sheet — see lib/catalog.ts.
 *
 * Adds and corrects; never deletes. A product missing from the sheet stays, because
 * the catalog is also built by hand while scanning and the sheet has no idea those
 * rows exist. Wiping them would silently undo the naming the user did in the aisle.
 *
 * The sheet wins on names it does supply: it is the list the user maintains on
 * purpose, so it must be able to fix a typo made on a phone at 6am. Counts are never
 * touched — this transaction opens `products` alone, so it structurally cannot.
 */
export async function importCatalog(rows: { code: string; name: string }[]): Promise<CatalogImportResult> {
  return db.transaction('rw', db.products, async () => {
    // Matched case-insensitively, like every other lookup: a code typed by hand as
    // "311283-194-m" before the sheet listed it as "-M" is the same goods. Keyed off
    // one read of the table rather than a bulkGet, because a bulkGet can only match
    // exactly and would quietly add the second row this exists to prevent.
    const byKey = new Map((await db.products.toArray()).map((p) => [codeKey(p.code), p]))
    const now = Date.now()
    const changed: Product[] = []
    let added = 0
    let renamed = 0

    for (const row of rows) {
      const key = codeKey(row.code)
      const prev = byKey.get(key)
      if (!prev) {
        added++
        const fresh = { code: row.code, name: row.name, createdAt: now }
        // Record it before the next row is considered: two sheet rows differing only
        // in case would otherwise both count as new and create the pair of products
        // that makes a case-insensitive lookup ambiguous.
        byKey.set(key, fresh)
        changed.push(fresh)
        continue
      }
      if (prev.name === row.name) continue
      renamed++
      // Spread the existing row: `createdAt` is when the user first met these goods,
      // and re-reading the sheet is not a new acquaintance. It also keeps `prev.code`
      // — `items` is keyed on it, so re-casing it would strand the counts.
      changed.push({ ...prev, name: row.name })
    }

    await db.products.bulkPut(changed)
    return { added, renamed, unchanged: rows.length - added - renamed }
  })
}

export async function createSession(input: Omit<Session, 'id' | 'startedAt'>): Promise<string> {
  const id = newId()
  await db.sessions.add({ ...input, id, startedAt: Date.now() })
  return id
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.items, async () => {
    await db.items.where({ sessionId }).delete()
    await db.sessions.delete(sessionId)
  })
}

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('app')) ?? { key: 'app', company: '', defaultPlace: '' }
}

/**
 * Saves one or more settings fields.
 *
 * Transactional, and an `update()` rather than a `put()` of a merged object — the
 * same read-modify-write hazard as the counters, one level up. Typing a company name
 * and then a warehouse name fires two saves in a row; a read-modify-write lets the
 * second one write back a snapshot taken before the first landed, silently undoing
 * it. `update()` also sends property-level operations, so two devices changing
 * different fields both survive.
 */
export async function saveSettings(patch: Partial<Omit<Settings, 'key'>>): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const existing = await db.settings.get('app')
    if (existing) await db.settings.update('app', patch)
    else await db.settings.put({ key: 'app', company: '', defaultPlace: '', ...patch })
  })
}

/** A session's counted lines, joined to product names, sorted for human reading. */
export interface Line {
  sessionId: string
  code: string
  name: string
  qty: number
  /** Callers must render a placeholder rather than `code` when this is true. */
  noBarcode: boolean
}

export async function getLines(sessionId: string): Promise<Line[]> {
  const items = await db.items.where({ sessionId }).toArray()
  const products = await db.products.bulkGet(items.map((i) => i.code))
  return items
    .map((item, idx) => {
      const product = products[idx]
      const noBarcode = product?.noBarcode ?? isNoBarcode(item.code)
      return {
        sessionId: item.sessionId,
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

/* ------------------------------------------------------------------------- */

/**
 * One-time move from the pre-sync database.
 *
 * Dexie cannot change a table's primary key in a version upgrade, and the old
 * schema's `++id` keys are exactly what has to go — so the sync-ready schema lives
 * under a new database name and the old rows are copied in once.
 *
 * The old database is deliberately left on disk. It costs a few hundred kB and is a
 * free rollback if anything here is wrong; deleting a user's only copy of their
 * stocktakes to save space would be a terrible trade.
 */
interface LegacySession extends Omit<Session, 'id'> {
  id: number
}
interface LegacyItem {
  id: number
  sessionId: number
  code: string
  qty: number
  updatedAt: number
}

export async function migrateFromLegacy(): Promise<{ sessions: number; items: number } | null> {
  const names = await Dexie.getDatabaseNames()
  if (!names.includes(LEGACY_DB_NAME)) return null
  // Only ever import into an empty database, or a re-run would duplicate everything.
  if ((await db.sessions.count()) > 0 || (await db.products.count()) > 0) return null

  const legacy = new Dexie(LEGACY_DB_NAME)
  legacy.version(1).stores({
    products: 'code, name',
    items: '++id, [sessionId+code], sessionId',
    sessions: '++id, startedAt',
    settings: 'key',
  })
  await legacy.open()
  try {
    const [products, sessions, items, settings] = await Promise.all([
      legacy.table<Product>('products').toArray(),
      legacy.table<LegacySession>('sessions').toArray(),
      legacy.table<LegacyItem>('items').toArray(),
      legacy.table<Settings>('settings').toArray(),
    ])
    if (!sessions.length && !products.length) return null

    const idMap = new Map<number, string>(sessions.map((s) => [s.id, newId()]))

    await db.transaction('rw', db.products, db.sessions, db.items, db.settings, async () => {
      await db.products.bulkPut(products)
      await db.settings.bulkPut(settings)
      await db.sessions.bulkPut(sessions.map((s) => ({ ...s, id: idMap.get(s.id)! })))
      // Collapse by [sessionId+code]: the old schema allowed duplicate rows for one
      // product, and the new key does not. Summing is the only answer that keeps the
      // stocktake's total honest.
      const merged = new Map<string, Item>()
      for (const item of items) {
        const sessionId = idMap.get(item.sessionId)
        if (!sessionId) continue // orphan — its session is gone
        const key = itemKey(sessionId, item.code)
        const seen = merged.get(key)
        if (seen) seen.qty += item.qty
        else
          merged.set(key, {
            sessionId,
            code: item.code,
            qty: item.qty,
            updatedAt: item.updatedAt,
          })
      }
      await db.items.bulkPut([...merged.values()])
    })

    return { sessions: sessions.length, items: items.length }
  } finally {
    legacy.close()
  }
}

/* ------------------------------------------------------------------------- */

/**
 * Whether anything has been counted since the last backup.
 *
 * The backup is the only copy that survives a lost phone, so the app has to nag —
 * but only when there is something to lose. Nagging with nothing new to save trains
 * people to dismiss the box without reading it, which is worse than not asking.
 */
export async function needsBackup(): Promise<boolean> {
  const [settings, lastItem, lastSession] = await Promise.all([
    getSettings(),
    db.items.orderBy('updatedAt').last(),
    db.sessions.orderBy('startedAt').last(),
  ])
  const newestChange = Math.max(lastItem?.updatedAt ?? 0, lastSession?.startedAt ?? 0)
  if (newestChange === 0) return false // nothing counted yet
  return newestChange > (settings.lastBackupAt ?? 0)
}

export async function markBackedUp(at = Date.now()): Promise<void> {
  await saveSettings({ lastBackupAt: at })
}
