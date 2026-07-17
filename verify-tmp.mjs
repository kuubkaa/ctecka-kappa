/**
 * The test that matters: does the real app sync a real stocktake between two
 * devices, against the real database?
 *
 * Device A counts. Device B — a separate browser, separate IndexedDB, same user —
 * must see it. Then B edits and A must see that. Uses a demo identity so this never
 * touches the owner's own data.
 */
import { chromium } from '@playwright/test'

const APP = 'http://localhost:4173/ctecka-kappa/e2e/harness.html'
const USER = `e2e-${Date.now()}@demo.local`

const browser = await chromium.launch({ channel: 'chromium' })

async function device(label) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`  [${label} pageerror]`, e.message))
  await page.goto(APP)
  await page.waitForFunction(() => window.__harnessReady === true)
  const login = await page.evaluate(async (user) => {
    try {
      await window.__db.db.cloud.login({ email: user, grant_type: 'demo' })
      return { ok: true, userId: window.__db.db.cloud.currentUserId }
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  }, USER)
  return { ctx, page, login }
}

const sync = (page) =>
  page.evaluate(async () => {
    await window.__db.db.cloud.sync({ wait: true })
    const s = window.__db.db.cloud.syncState.value
    return { phase: s.phase, status: s.status, error: s.error?.message ?? null }
  })

console.log('uživatel:', USER)

const a = await device('A')
console.log('A přihlášení:', a.login.ok ? '✓ ' + a.login.userId : '✗ ' + a.login.error)
if (!a.login.ok) { await browser.close(); process.exit(1) }

console.log('\n--- A: založí inventuru a napočítá')
const sessionId = await a.page.evaluate(async () => {
  const db = window.__db
  const id = await db.createSession({ name: 'Sync test', place: 'Sklad', handoverFrom: '', handoverTo: '' })
  await db.nameAndCount(id, '8594001020304', 'Šťavnatá hruška ďábelská')
  for (let i = 0; i < 11; i++) await db.recordScan(id, '8594001020304')
  await db.addWithoutBarcode(id, 'Jablka volně', 37)
  return id
})
console.log('A stav:', JSON.stringify(await sync(a.page)))
console.log('A napočítal:', JSON.stringify(await a.page.evaluate((id) => window.__db.getLines(id).then(l => l.map(x => `${x.name}=${x.qty}`)), sessionId)))

console.log('\n--- B: jiné zařízení, stejný uživatel')
const b = await device('B')
console.log('B přihlášení:', b.login.ok ? '✓' : '✗ ' + b.login.error)
console.log('B stav:', JSON.stringify(await sync(b.page)))

const bLines = await b.page.evaluate((id) => window.__db.getLines(id).then(l => l.map(x => `${x.name}=${x.qty}`)), sessionId)
console.log('B vidí:', JSON.stringify(bLines))

console.log('\n--- B: opraví počet na 48, A to má uvidět')
await b.page.evaluate(async (id) => { await window.__db.setQty(id, '8594001020304', 48) }, sessionId)
await sync(b.page)
await sync(a.page)
const aAfter = await a.page.evaluate((id) => window.__db.getLines(id).then(l => l.map(x => `${x.name}=${x.qty}`)), sessionId)
console.log('A po dorovnání:', JSON.stringify(aAfter))

console.log('\n--- obě zařízení připočtou naráz (tady staré počítání ztrácelo kusy)')
await Promise.all([
  a.page.evaluate(async (id) => { for (let i = 0; i < 5; i++) await window.__db.bumpQty(id, '8594001020304', 1) }, sessionId),
  b.page.evaluate(async (id) => { for (let i = 0; i < 3; i++) await window.__db.bumpQty(id, '8594001020304', 1) }, sessionId),
])
await sync(a.page); await sync(b.page); await sync(a.page); await sync(b.page)
const finalA = await a.page.evaluate((id) => window.__db.getLines(id).then(l => l.map(x => `${x.name}=${x.qty}`)), sessionId)
const finalB = await b.page.evaluate((id) => window.__db.getLines(id).then(l => l.map(x => `${x.name}=${x.qty}`)), sessionId)
console.log('A:', JSON.stringify(finalA))
console.log('B:', JSON.stringify(finalB))

await browser.close()

const hruska = (arr) => Number(arr.find((s) => s.startsWith('Šťavnatá'))?.split('=')[1] ?? -1)
const checks = [
  [bLines.length === 2, 'B stáhlo obě položky'],
  [hruska(bLines) === 12, 'B vidí správný počet 12'],
  [hruska(aAfter) === 48, 'A převzalo opravu z B (48)'],
  [hruska(finalA) === 56 && hruska(finalB) === 56, `souběžné přičtení: 48+5+3 = 56 (A=${hruska(finalA)}, B=${hruska(finalB)})`],
  [JSON.stringify(finalA.sort()) === JSON.stringify(finalB.sort()), 'obě zařízení se shodla'],
]
let ok = true
console.log()
for (const [pass, label] of checks) { if (!pass) ok = false; console.log(`${pass ? '✓' : '✗'} ${label}`) }
console.log('\n' + (ok ? '✓ SYNCHRONIZACE FUNGUJE' : '✗ NĚCO NESEDÍ'))
process.exit(ok ? 0 : 1)
