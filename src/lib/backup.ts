import {
  db,
  itemKey,
  newId,
  type Item,
  type Product,
  type Session,
  type Settings,
} from '../db'

/**
 * Whole-database export and import.
 *
 * This is the app's backup, its migration tool, and its way out if the sync vendor
 * ever stops suiting us — which is why the format is plain readable JSON rather
 * than anything clever.
 */

const FORMAT = 'ctecka-kappa-backup'
/**
 * 1 — pre-sync: numeric session/item ids.
 * 2 — sync-ready: string session ids, items keyed by [sessionId+code].
 *
 * `importBackup` must keep reading version 1 forever. Files were handed out before
 * the schema changed, and a backup you can no longer restore is not a backup.
 */
const FORMAT_VERSION = 2

export interface Backup {
  format: typeof FORMAT
  version: number
  exportedAt: string
  products: Product[]
  sessions: Session[]
  items: Item[]
  settings: Settings[]
}

/** Either format's rows — ids are numbers in v1, strings in v2. */
type AnySession = Omit<Session, 'id'> & { id: string | number }
type AnyItem = { sessionId: string | number; code: string; qty: number; updatedAt: number }

export async function exportBackup(): Promise<Backup> {
  // One transaction, so a scan landing mid-export can't produce a file where an
  // item references a session that isn't in it.
  return db.transaction('r', db.products, db.sessions, db.items, db.settings, async () => ({
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    products: await db.products.toArray(),
    sessions: await db.sessions.toArray(),
    items: await db.items.toArray(),
    settings: await db.settings.toArray(),
  }))
}

export function backupFileName(at = new Date()): string {
  const stamp = at.toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `inventura-zaloha-${stamp}.json`
}

export class BackupError extends Error {}

/** Rejects anything that isn't ours, so a wrong file can't half-import and corrupt data. */
export function parseBackup(text: string): Backup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BackupError('Tohle není zálohovací soubor — nejde přečíst.')
  }
  const b = raw as Partial<Backup>
  if (b?.format !== FORMAT) {
    throw new BackupError('Tenhle soubor není záloha z této aplikace.')
  }
  if (typeof b.version !== 'number' || b.version > FORMAT_VERSION) {
    throw new BackupError(
      `Záloha je z novější verze aplikace (${String(b.version)}). Aktualizuj aplikaci a zkus to znovu.`,
    )
  }
  for (const key of ['products', 'sessions', 'items', 'settings'] as const) {
    if (!Array.isArray(b[key])) throw new BackupError(`Záloha je poškozená — chybí ${key}.`)
  }
  return b as Backup
}

export interface ImportResult {
  products: number
  sessions: number
  items: number
}

/**
 * Merges a backup into whatever is already here — it never wipes.
 *
 * A restore that silently replaced the current device's counts would be the worst
 * possible bug in a backup feature, so sessions from the file are always given fresh
 * ids and added as new stocktakes rather than matched against existing ones.
 * Duplicating a stocktake is annoying; erasing one is unrecoverable.
 */
export async function importBackup(backup: Backup): Promise<ImportResult> {
  return db.transaction('rw', db.products, db.sessions, db.items, async () => {
    // Products are keyed by barcode, so the same goods really are the same row.
    // put() lets an imported name correct a local one.
    await db.products.bulkPut(backup.products)

    // Always re-key, in both formats: a v1 file's session 1 and this device's
    // session 1 are unrelated stocktakes, and even a v2 file could be a restore
    // alongside the very rows it was exported from.
    const idMap = new Map<string | number, string>()
    for (const session of backup.sessions as AnySession[]) {
      const id = newId()
      idMap.set(session.id, id)
      await db.sessions.add({ ...session, id })
    }

    // Collapse by [sessionId+code]: v1 allowed several rows for one product in one
    // stocktake, and the current key does not. Summing keeps the total honest.
    const merged = new Map<string, Item>()
    for (const item of backup.items as AnyItem[]) {
      const sessionId = idMap.get(item.sessionId)
      if (!sessionId) continue // orphan; its session wasn't in the file
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

    return {
      products: backup.products.length,
      sessions: backup.sessions.length,
      items: merged.size,
    }
  })
}
