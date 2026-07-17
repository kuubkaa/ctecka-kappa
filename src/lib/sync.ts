import { useEffect, useState } from 'react'
import { db } from '../db'

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

/**
 * Signs out. `force: false` on purpose — Dexie refuses while changes are still
 * unsynced, which is the correct answer: silently dropping a warehouse's worth of
 * counting to honour a button press would be indefensible.
 */
export async function signOut(): Promise<void> {
  await db.cloud.logout()
}
