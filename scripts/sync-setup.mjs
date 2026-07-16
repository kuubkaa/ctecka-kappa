/**
 * One-command Dexie Cloud setup: `npm run sync:setup`
 *
 * The `create` step is interactive by design — it emails a one-time code to prove
 * you own the address, so it cannot be automated and it cannot be done for you.
 * Everything either side of it can be, so it is: this creates the database,
 * whitelists the deployed origin, and prints the URL to paste back.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = join(ROOT, 'dexie-cloud.json')
const ORIGIN = 'https://kuubkaa.github.io'

const say = (msg) => console.log(`\n\x1b[1m${msg}\x1b[0m`)

function run(args) {
  // stdio: 'inherit' — the OTP prompt has to reach a real keyboard.
  const res = spawnSync('npx', ['dexie-cloud', ...args], { cwd: ROOT, stdio: 'inherit' })
  return res.status === 0
}

if (existsSync(CONFIG)) {
  const { dbUrl } = JSON.parse(readFileSync(CONFIG, 'utf8'))
  say('Databáze už existuje:')
  console.log(`  ${dbUrl}\n`)
  console.log('Když chceš začít znovu, smaž dexie-cloud.json a dexie-cloud.key.')
  process.exit(0)
}

say('1/2 — Zakládám databázi')
console.log('Zeptá se na e-mail, pošle ti na něj kód, ten sem vlož.')
console.log('(Tenhle krok za tebe nikdo udělat nemůže — proto ten kód existuje.)\n')

run(['create'])

// The CLI exits 0 even when the prompt is cancelled, so the config file — not the
// exit code — is what says whether a database actually exists.
if (!existsSync(CONFIG)) {
  console.error('\n✗ Databáze nevznikla (zrušeno, nebo se něco nepovedlo).')
  console.error('  Spusť `npm run sync:setup` znovu. Když to bude psát chybu, pošli mi ji.')
  process.exit(1)
}

const { dbUrl } = JSON.parse(readFileSync(CONFIG, 'utf8'))

say('2/2 — Povoluju adresu aplikace')
if (!run(['whitelist', ORIGIN])) {
  console.error(`\n✗ Nepovedlo se. Spusť ručně: npx dexie-cloud whitelist ${ORIGIN}`)
  process.exit(1)
}

say('✓ Hotovo. Pošli mi tenhle řádek:')
console.log(`\n  ${dbUrl}\n`)
console.log('Klíč (dexie-cloud.key) zůstává u tebe — do gitu se nedostane, je zablokovaný.')
