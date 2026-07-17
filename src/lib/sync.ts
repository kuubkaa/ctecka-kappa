import { useEffect, useState } from 'react'
import { db } from '../db'
import { exportBackup, importBackup } from './backup'

/**
 * The user's one stated fear about sync was that it would switch itself off
 * quietly. So the app never guesses: it reads the real state out of the sync
 * engine and says it out loud. A stopped sync is allowed; a stopped sync nobody
 * mentioned is not.
 */
export type SyncHealth =
  | 'off' // not signed in — data is on this device only, by choice
  | 'syncing'
  | 'ok'
  | 'offline'
  | 'error'
  | 'expired' // the account lost its licence — the silent killer, made loud

export interface SyncInfo {
  health: SyncHealth
  /** Signed-in identity, or null. */
  user: string | null
  message: string
  detail?: string
}

const MESSAGES: Record<SyncHealth, { message: string; detail?: string }> = {
  off: {
    message: 'Nesynchronizuje se',
    detail: 'Data jsou jen v tomhle zařízení. Přihlas se, ať je vidíš i na počítači.',
  },
  syncing: { message: 'Synchronizuji…' },
  ok: { message: 'Synchronizováno' },
  offline: {
    message: 'Bez připojení',
    detail: 'Počítej dál — jakmile bude signál, samo se to dorovná.',
  },
  error: {
    message: 'Synchronizace vázne',
    detail: 'Data máš v pořádku v telefonu. Zkusím to znovu sám.',
  },
  expired: {
    message: 'Synchronizace je zastavená',
    detail: 'Účtu vypršela platnost. Data jsou v bezpečí v telefonu — napiš mi.',
  },
}

export function useSync(): SyncInfo {
  const [info, setInfo] = useState<SyncInfo>(() => ({
    health: 'off',
    user: null,
    ...MESSAGES.off,
  }))

  useEffect(() => {
    const recompute = () => {
      const login = db.cloud.currentUser.value
      const state = db.cloud.syncState.value
      const userId = login?.userId
      const user = !userId || userId === 'unauthorized' ? null : userId

      let health: SyncHealth
      if (state.license && state.license !== 'ok') health = 'expired'
      else if (!user) health = 'off'
      else if (state.phase === 'offline' || state.status === 'offline') health = 'offline'
      else if (state.phase === 'error' || state.status === 'error') health = 'error'
      else if (state.phase === 'pushing' || state.phase === 'pulling') health = 'syncing'
      else if (state.phase === 'in-sync') health = 'ok'
      // 'initial' and 'not-in-sync' mean "signed in, nothing has happened yet" —
      // reporting an error there would cry wolf on every cold start.
      else health = 'syncing'

      setInfo({ health, user, ...MESSAGES[health] })
    }

    const subs = [db.cloud.currentUser.subscribe(recompute), db.cloud.syncState.subscribe(recompute)]
    return () => subs.forEach((s) => s.unsubscribe())
  }, [])

  return info
}

/**
 * 🔴 SIGN-IN IS DISABLED — IT DESTROYS DATA.
 *
 * Measured, not theorised. Count a stocktake while logged out, then log in:
 *
 *     before login:  1 stocktake, 2 items
 *     1s after:      1 stocktake, 2 items
 *     2s after:      0 stocktakes, 0 items      <-- gone, silently
 *
 * Rows written while logged out belong to the `unauthorized` user. Logging in
 * switches identity, the first sync finds no such rows on the server, and the local
 * ones are pruned. The user is left with an app that looks brand new.
 *
 * The UI must not offer a button that can do this, so it doesn't. Sync stays off
 * and says so; counting, protocols and backup are unaffected.
 *
 * Not yet established: whether this is the addon's real behaviour on login, or an
 * artefact of the test harness reconfiguring db.cloud after open (something the app
 * never does). Until that's answered and a data-preserving path is proven, the
 * button stays out. An app that doesn't sync yet is a disappointment; an app that
 * eats a warehouse's worth of counting is not survivable.
 */
export const SIGN_IN_DISABLED_REASON =
  'Přihlašování je dočasně vypnuté — při zapínání synchronizace jsem našel chybu, ' +
  'po které by se data v telefonu smazala. Než ji opravím, zůstává vypnuté. ' +
  'Počítání, protokoly i záloha fungují normálně.'

/** Give the first post-login sync time to do whatever it is going to do. */
const SETTLE_TIMEOUT_MS = 12_000

async function waitForSyncToSettle(): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS
  while (Date.now() < deadline) {
    const phase = db.cloud.syncState.value.phase
    if (phase === 'in-sync' || phase === 'error' || phase === 'offline') return
    await new Promise((r) => setTimeout(r, 300))
  }
}

/**
 * 🔴 PROVEN INSUFFICIENT — DO NOT WIRE THIS TO A BUTTON. Kept as the starting point
 * for the real fix, and as a record of why the obvious approach fails.
 *
 * The idea: copy the data, sign in, see what survived, put back what didn't.
 * Measured result:
 *
 *     before sign-in:   1 stocktake, 2 items
 *     guard checks:     1 stocktake, 2 items  -> "nothing lost", rescues nothing
 *     2s later:         0 stocktakes, 0 items
 *
 * The pruning is NOT part of the sign-in sync. `syncState.phase` reaches `in-sync`
 * while the rows are still present, and the delete lands afterwards — so any guard
 * that waits for sync to settle and then looks is racing something it cannot see
 * coming. Waiting longer would only move the race, not win it.
 *
 * What this measurement does establish: rows written while logged out belong to the
 * `unauthorized` user and are eventually removed. The fix therefore has to stop
 * *waiting* and start *acting*: after sign-in, deliberately clear the doomed local
 * rows and re-import the copy as the signed-in user, so the rows are owned by
 * someone the server recognises. That must be crash-safe (the copy has to outlive a
 * reload mid-operation), which is why it isn't a five-line change.
 *
 * `login` is injected so the same code path runs under test (token sign-in, which
 * reproduces the loss) and in production (Google/OTP, which no machine here can
 * perform). A guard exercised only on the untested path would be worthless.
 */
export async function signInPreservingData(login: () => Promise<void>): Promise<{
  rescued: number
}> {
  const before = await exportBackup()
  const hadData = before.sessions.length > 0 || before.products.length > 0

  await login()

  if (!hadData) return { rescued: 0 }
  await waitForSyncToSettle()

  const after = await exportBackup()
  const survived = new Set(after.sessions.map((s) => s.id))
  const lost = before.sessions.filter((s) => !survived.has(s.id))
  // Products can be pruned independently of sessions — a catalog is worth rescuing
  // even when the stocktakes came through.
  const keptProducts = new Set(after.products.map((p) => p.code))
  const lostProducts = before.products.filter((p) => !keptProducts.has(p.code))

  if (!lost.length && !lostProducts.length) return { rescued: 0 }

  const lostIds = new Set(lost.map((s) => s.id))
  await importBackup({
    ...before,
    sessions: lost,
    items: before.items.filter((i) => lostIds.has(i.sessionId)),
    products: lostProducts.length ? before.products : [],
  })
  return { rescued: lost.length }
}

/**
 * Signs out. `force: false` on purpose — Dexie refuses while changes are still
 * unsynced, which is the correct answer: silently dropping a warehouse's worth of
 * counting to honour a button press would be indefensible.
 */
export async function signOut(): Promise<void> {
  await db.cloud.logout()
}
