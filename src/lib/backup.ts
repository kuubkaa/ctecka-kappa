import { db, type Item, type Product, type Session, type Settings } from '../db'

/**
 * Whole-database export and import.
 *
 * This is the app's only backup: everything lives in one phone's IndexedDB, so a
 * lost or wiped phone is a lost stocktake. It is also the migration tool and the
 * way out if the sync vendor ever stops suiting us — which is why the format is
 * plain, readable JSON rather than anything clever.
 */

const FORMAT = 'ctecka-kappa-backup'
/** Bump only on a breaking shape change; `importBackup` must keep reading old ones. */
const FORMAT_VERSION = 1

export interface Backup {
  format: typeof FORMAT
  version: number
  exportedAt: string
  products: Product[]
  sessions: Session[]
  items: Item[]
  settings: Settings[]
}

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
 * possible bug in a backup feature, so sessions from the file are always added as
 * new stocktakes rather than matched against existing ones. Duplicating a stocktake
 * is annoying; erasing one is unrecoverable.
 */
export async function importBackup(backup: Backup): Promise<ImportResult> {
  return db.transaction('rw', db.products, db.sessions, db.items, async () => {
    // Products are keyed by barcode, so the same goods really are the same row.
    // put() lets an imported name correct a local one.
    await db.products.bulkPut(backup.products)

    // Session ids are per-device counters, so the file's id 3 and this device's id 3
    // are different stocktakes. Re-key on insert and remap the items to match.
    const idMap = new Map<number, number>()
    let sessions = 0
    for (const session of backup.sessions) {
      const { id: oldId, ...rest } = session
      const newId = await db.sessions.add(rest as Session)
      idMap.set(oldId, newId)
      sessions++
    }

    let items = 0
    for (const item of backup.items) {
      const sessionId = idMap.get(item.sessionId)
      if (sessionId === undefined) continue // orphan; its session wasn't in the file
      const { id: _drop, ...rest } = item
      await db.items.add({ ...rest, sessionId } as Item)
      items++
    }

    return { products: backup.products.length, sessions, items }
  })
}
