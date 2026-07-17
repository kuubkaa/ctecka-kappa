import { useEffect, useState } from 'react'
import { CLOUD_URL, db } from '../db'
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
 * Signing in destroys data that was counted before it — measured, ~2s after login,
 * silently. Until that's fixed, sign-in is allowed ONLY on an empty app, where there
 * is provably nothing to lose. The route for a device that already holds stocktakes
 * is Zálohovat → sign in on an empty app → Načíst zálohu: rows created while signed
 * in belong to the user and are never pruned.
 */
export class NotEmptyError extends Error {
  /** Stable across minification, unlike the class name — tests check this. */
  readonly code = 'NOT_EMPTY'
  constructor() {
    super('V aplikaci už jsou data — přihlášení by je smazalo.')
  }
}

export async function isEmpty(): Promise<boolean> {
  const [sessions, products] = await Promise.all([db.sessions.count(), db.products.count()])
  return sessions === 0 && products === 0
}

/**
 * Which sign-in methods the database actually offers — asked, not assumed.
 *
 * A "Přihlásit Googlem" button shipped on a guess, and the server answered
 * `OAuth provider 'google' not configured or not enabled`. It reports the truth at
 * GET /auth-providers, so ask it: the UI then can't offer something that doesn't
 * exist, and if a provider is enabled later the button appears on its own.
 *
 *     {"providers":[],"otpEnabled":true}   <- this database, today
 */
export interface SignInMethods {
  otp: boolean
  providers: string[]
}

export async function availableSignIns(): Promise<SignInMethods> {
  try {
    const res = await fetch(`${CLOUD_URL}/auth-providers`)
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { providers?: string[]; otpEnabled?: boolean }
    return { otp: data.otpEnabled !== false, providers: data.providers ?? [] }
  } catch {
    // Offline, or the server is unreachable — in which case signing in isn't going
    // to work anyway. Email is the documented default; offering it and failing
    // honestly beats offering nothing and explaining nothing.
    return { otp: true, providers: [] }
  }
}

/** Human names for the providers Dexie Cloud can be configured with. */
export const PROVIDER_LABELS: Record<string, string> = {
  google: 'Googlem',
  github: 'GitHubem',
  microsoft: 'Microsoftem',
  apple: 'Apple',
}

export const SIGN_IN_BLOCKED_REASON =
  'Přihlášení tady zatím nenabízím: v aplikaci máš data a při zapínání synchronizace ' +
  'jsem našel chybu, po které by zmizela. Cesta kolem: dej Zálohovat, přihlas se na ' +
  'zařízení, kde ještě nic nemáš, a tam zálohu načti.'

/**
 * Signs in — but refuses if anything is stored.
 *
 * The check is here as well as in the UI on purpose. The screen hides the button
 * when data exists, but a stale render or a fast tap must not be the thing standing
 * between someone and losing a month of counting. Two independent locks on the one
 * door that has been measured to eat data.
 */
export async function signIn(method: 'email' | { provider: string }): Promise<void> {
  if (!(await isEmpty())) throw new NotEmptyError()
  await db.cloud.login(method === 'email' ? { grant_type: 'otp' } : { provider: method.provider })
}

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
