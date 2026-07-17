import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  addWithoutBarcode,
  bumpQty,
  db,
  deleteSession,
  getLines,
  getSettings,
  isNoBarcode,
  linkAndCount,
  nameAndCount,
  recordScan,
  renameProduct,
  setQty,
  type Line,
  type Product,
} from '../db'
import { entries, pieceWord, pieces } from '../lib/czech'
import { primeAudio } from '../lib/feedback'
import { Scanner, type ScanOutcomeKind } from '../components/Scanner'
import { Button, ConfirmDialog, Dialog, EmptyState, Field } from '../components/ui'

export function SessionScreen() {
  const { id } = useParams()
  const sessionId = id ?? ''
  const navigate = useNavigate()

  const [scanning, setScanning] = useState(false)
  const [unknownCode, setUnknownCode] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  /** 'new' = name it; 'link' = it's in the catalog already, under another code. */
  const [unknownMode, setUnknownMode] = useState<'new' | 'link'>('new')
  const [linkSearch, setLinkSearch] = useState('')
  // `seq` re-keys the confirmation card so its pop animation replays on every scan.
  const [lastScan, setLastScan] = useState<{ name: string; qty: number; seq: number } | null>(null)
  const [editing, setEditing] = useState<Line | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editName, setEditName] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualMode, setManualMode] = useState<'code' | 'nocode'>('code')
  const [manualCode, setManualCode] = useState('')
  const [looseName, setLooseName] = useState('')
  const [looseQty, setLooseQty] = useState('1')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const session = useLiveQuery(() => db.sessions.get(sessionId), [sessionId])
  const lines = useLiveQuery(() => getLines(sessionId), [sessionId]) ?? []
  // Only while the unknown-code dialog is up: the catalog runs to hundreds of rows and
  // the scan path has no use for it.
  const catalog = useLiveQuery(
    () => (unknownCode ? db.products.orderBy('name').toArray() : Promise.resolve([] as Product[])),
    [unknownCode],
  )

  const LINK_LIMIT = 25
  const linkHits = useMemo(() => {
    const q = linkSearch.trim().toLocaleLowerCase('cs')
    const all = catalog ?? []
    if (!q) return all
    return all.filter(
      (p) =>
        p.name.toLocaleLowerCase('cs').includes(q) ||
        (!isNoBarcode(p.code) && p.code.toLocaleLowerCase('cs').includes(q)),
    )
  }, [catalog, linkSearch])
  const linkMatches = linkHits.slice(0, LINK_LIMIT)
  const linkHiddenCount = linkHits.length - linkMatches.length

  const totalPieces = lines.reduce((sum, l) => sum + l.qty, 0)

  const handleDetect = useCallback(
    async (code: string): Promise<ScanOutcomeKind> => {
      const outcome = await recordScan(sessionId, code)
      if (outcome.kind === 'unknown') {
        setNewName('')
        setLinkSearch('')
        setUnknownMode('new')
        setUnknownCode(code) // Pauses the scanner until the user answers.
        return 'unknown'
      }
      setLastScan({ name: outcome.product.name, qty: outcome.qty, seq: Date.now() })
      return 'counted'
    },
    [sessionId],
  )

  async function saveNewProduct() {
    const code = unknownCode
    if (!code || !newName.trim()) return
    await nameAndCount(sessionId, code, newName)
    setLastScan({ name: newName.trim(), qty: 1, seq: Date.now() })
    setUnknownCode(null)
  }

  /** Points the scanned code at goods that are already in the catalog. */
  async function linkToProduct(productCode: string, name: string) {
    const code = unknownCode
    if (!code) return
    await linkAndCount(sessionId, code, productCode)
    const qty = (await db.items.get([sessionId, productCode]))?.qty ?? 1
    setLastScan({ name, qty, seq: Date.now() })
    setUnknownCode(null)
  }

  function openManual(mode: 'code' | 'nocode') {
    setManualMode(mode)
    setManualCode('')
    setLooseName('')
    setLooseQty('1')
    setManualOpen(true)
  }

  async function addManual() {
    const code = manualCode.trim()
    if (!code) return
    setManualOpen(false)
    setManualCode('')
    await handleDetect(code)
  }

  async function addLoose() {
    const name = looseName.trim()
    const qty = Number(looseQty)
    if (!name || !Number.isFinite(qty) || qty <= 0) return
    setManualOpen(false)
    await addWithoutBarcode(sessionId, name, qty)
  }

  function openEdit(line: Line) {
    setEditing(line)
    setEditQty(String(line.qty))
    setEditName(line.name)
  }

  async function saveEdit() {
    if (!editing) return
    const qty = Number(editQty)
    if (Number.isFinite(qty)) await setQty(sessionId, editing.code, Math.max(0, Math.trunc(qty)))
    if (editName.trim() && editName.trim() !== editing.name) {
      await renameProduct(editing.code, editName)
    }
    setEditing(null)
  }

  async function exportPdf() {
    if (!session) return
    setExporting(true)
    setError(null)
    try {
      // jsPDF and the embedded font are a third of the app's code and are needed
      // once per stocktake, not at boot. The service worker precaches this chunk,
      // so exporting still works with no signal.
      const { buildProtocolPdf, downloadBlob, protocolFileName } = await import('../lib/pdf')
      const [fresh, settings] = await Promise.all([getLines(sessionId), getSettings()])
      const blob = await buildProtocolPdf({ session, lines: fresh, settings })
      downloadBlob(blob, protocolFileName(session))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Protokol se nepodařilo vytvořit.')
    } finally {
      setExporting(false)
    }
  }

  async function toggleClosed() {
    if (!session) return
    await db.sessions.update(sessionId, { closedAt: session.closedAt ? undefined : Date.now() })
  }

  if (session === undefined) return <div className="p-6 text-slate-500">Načítám…</div>
  if (session === null)
    return (
      <EmptyState title="Inventura nenalezena">
        <Link to="/" className="underline">
          Zpět na seznam
        </Link>
      </EmptyState>
    )

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col">
      <header className="order-1 px-5 pb-3 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <Link to="/" className="-ml-2 inline-block rounded-lg px-2 py-1 text-slate-600">
          ‹ Inventury
        </Link>
        <h1 className="mt-1 text-xl font-bold">{session.name}</h1>
        <p className="text-sm text-slate-500">
          {session.place || 'bez místa'}
          {session.closedAt && ' · ukončeno'}
        </p>
        <p className="mt-2 text-sm font-medium text-slate-700">
          {entries(lines.length)} · {pieces(totalPieces)}
        </p>
      </header>

      <main className="order-2 flex-1 px-5 pb-4 md:order-3 md:pt-4">
        {lines.length === 0 ? (
          <EmptyState title="Zatím nic naskenováno">
            Stiskni Skenovat a namiř fotoaparát na čárový kód.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {lines.map((line) => (
              <li
                key={line.code}
                className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm"
              >
                <button
                  onClick={() => openEdit(line)}
                  className="min-w-0 flex-1 text-left active:opacity-60"
                >
                  <p className="truncate font-medium">{line.name}</p>
                  {line.noBarcode ? (
                    <p className="truncate text-xs italic text-slate-400">bez čárového kódu</p>
                  ) : (
                    <p className="truncate font-mono text-xs text-slate-500">{line.code}</p>
                  )}
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    aria-label={`Ubrat ${line.name}`}
                    onClick={() => bumpQty(sessionId, line.code, -1)}
                    className="h-10 w-10 rounded-lg bg-slate-100 text-xl font-medium active:bg-slate-200"
                  >
                    −
                  </button>
                  <button
                    onClick={() => openEdit(line)}
                    className="w-12 text-center text-lg font-semibold tabular-nums"
                  >
                    {line.qty}
                  </button>
                  <button
                    aria-label={`Přidat ${line.name}`}
                    onClick={() => bumpQty(sessionId, line.code, 1)}
                    className="h-10 w-10 rounded-lg bg-slate-100 text-xl font-medium active:bg-slate-200"
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        <div className="mt-8 space-y-3 border-t border-slate-200 pt-6">
          <Button variant="secondary" className="w-full" onClick={exportPdf} disabled={exporting}>
            {exporting ? 'Vytvářím protokol…' : 'Stáhnout předávací protokol (PDF)'}
          </Button>
          <Button variant="secondary" className="w-full" onClick={toggleClosed}>
            {session.closedAt ? 'Znovu otevřít inventuru' : 'Ukončit inventuru'}
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setConfirmDelete(true)}>
            Smazat inventuru
          </Button>
        </div>
      </main>

      {/* On a phone the actions belong under the thumb, pinned to the bottom. On a
          desktop that idiom strands them at the foot of the monitor, far from the
          content — so on wide screens they sit under the header instead. Reordering
          rather than duplicating keeps one set of buttons and one tab order. */}
      <div className="order-3 sticky bottom-0 flex gap-3 bg-gradient-to-t from-slate-100 via-slate-100 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:static md:order-2 md:bg-none md:px-5 md:py-0">
        <Button variant="secondary" onClick={() => openManual('code')}>
          Ručně
        </Button>
        <Button variant="secondary" onClick={() => openManual('nocode')}>
          Bez kódu
        </Button>
        {/* Camera opens straight from this tap — deferring it past the gesture is
            what makes iOS re-prompt and time out mid-count. primeAudio must ride the
            same tap: iOS only lets a gesture start an AudioContext, and creating one
            later in the detect loop leaves the confirmation beep silently missing. */}
        <Button
          className="flex-1 text-lg"
          onClick={() => {
            primeAudio()
            setScanning(true)
          }}
        >
          Skenovat
        </Button>
      </div>

      {scanning && (
        <Scanner
          paused={unknownCode !== null}
          onDetect={handleDetect}
          onClose={() => {
            setScanning(false)
            setLastScan(null)
          }}
          status={
            lastScan && (
              <div
                // Re-keying on every scan restarts the animation, so a repeat scan of
                // the same item reads as a new event rather than a silent increment.
                key={lastScan.seq}
                className="animate-scan-pop rounded-2xl bg-white p-4 text-center shadow-2xl"
                role="status"
                aria-live="polite"
              >
                <p className="truncate text-lg font-semibold">{lastScan.name}</p>
                <p className="mt-1 text-5xl font-bold tabular-nums text-emerald-600">
                  {lastScan.qty}
                </p>
                <p className="text-sm text-slate-500">{pieceWord(lastScan.qty)} celkem</p>
              </div>
            )
          }
        />
      )}

      <Dialog open={unknownCode !== null} title="Neznámý kód">
        <p className="mb-1 text-sm text-slate-600">Tenhle kód ještě neznám:</p>
        <p className="mb-4 font-mono text-sm font-medium">{unknownCode}</p>

        {/* Offered only when there is a catalog to pick from — on a fresh phone the
            choice would be between naming the goods and an empty list. */}
        {!!catalog?.length && (
          <div role="tablist" className="mb-5 flex gap-1 rounded-xl bg-slate-100 p-1">
            {(
              [
                ['new', 'Nové zboží'],
                ['link', 'Mám ho v katalogu'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                role="tab"
                aria-selected={unknownMode === mode}
                onClick={() => setUnknownMode(mode)}
                className={`flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors ${
                  unknownMode === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {unknownMode === 'new' || !catalog?.length ? (
          <>
            <Field
              label="Název zboží"
              autoFocus
              value={newName}
              placeholder="např. Coca-Cola 0,5 l"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveNewProduct()}
              hint="Příště už se doplní sám."
            />
            <div className="mt-5 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setUnknownCode(null)}>
                Přeskočit
              </Button>
              <Button className="flex-1" onClick={saveNewProduct} disabled={!newName.trim()}>
                Uložit a započítat
              </Button>
            </div>
          </>
        ) : (
          <>
            <Field
              label="Najdi zboží"
              autoFocus
              value={linkSearch}
              placeholder="část názvu nebo kódu"
              onChange={(e) => setLinkSearch(e.target.value)}
              hint="Kód se k vybranému zboží přiřadí natrvalo. Příště se započítá sám."
            />
            <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
              {linkMatches.map((product) => (
                <li key={product.code}>
                  <button
                    onClick={() => linkToProduct(product.code, product.name)}
                    className="w-full rounded-xl border border-slate-200 p-3 text-left active:bg-slate-100"
                  >
                    <p className="truncate font-medium">{product.name}</p>
                    {isNoBarcode(product.code) ? (
                      <p className="truncate text-xs italic text-slate-400">bez čárového kódu</p>
                    ) : (
                      <p className="truncate font-mono text-xs text-slate-500">{product.code}</p>
                    )}
                  </button>
                </li>
              ))}
              {!linkMatches.length && (
                <li className="py-6 text-center text-sm text-slate-500">
                  Nic takového v katalogu není.
                </li>
              )}
              {/* Never truncate silently: a hidden match reads as "it isn't there" and
                  the user names it again, which is the duplicate row this exists to stop. */}
              {linkHiddenCount > 0 && (
                <li className="py-2 text-center text-xs text-slate-500">
                  …a další {linkHiddenCount}. Zpřesni hledání.
                </li>
              )}
            </ul>
            <div className="mt-5">
              <Button variant="secondary" className="w-full" onClick={() => setUnknownCode(null)}>
                Přeskočit
              </Button>
            </div>
          </>
        )}
      </Dialog>

      <Dialog open={editing !== null} title="Upravit položku" onClose={() => setEditing(null)}>
        <div className="space-y-4">
          <Field
            label="Název zboží"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />
          <Field
            label="Počet kusů"
            type="number"
            inputMode="numeric"
            value={editQty}
            onChange={(e) => setEditQty(e.target.value)}
            hint="Nula položku z inventury odebere."
          />
        </div>
        <div className="mt-5 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setEditing(null)}>
            Zrušit
          </Button>
          <Button className="flex-1" onClick={saveEdit}>
            Uložit
          </Button>
        </div>
      </Dialog>

      <Dialog open={manualOpen} title="Přidat ručně" onClose={() => setManualOpen(false)}>
        <div role="tablist" className="mb-5 flex gap-1 rounded-xl bg-slate-100 p-1">
          {(
            [
              ['code', 'Podle kódu'],
              ['nocode', 'Bez kódu'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              role="tab"
              aria-selected={manualMode === mode}
              onClick={() => setManualMode(mode)}
              className={`flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors ${
                manualMode === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {manualMode === 'code' ? (
          <>
            {/*
              A text keyboard, not `inputMode="numeric"`. The numeric keypad has no
              letters at all, so a code like 311283-194-M was literally untypeable —
              on the one screen that exists for when a label won't scan. Autocorrect
              and auto-capitalisation are off for the same reason: a phone "fixing" a
              product code is never helping.
            */}
            <Field
              label="Kód zboží"
              autoFocus
              inputMode="text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addManual()}
              hint="Když je kód poškozený nebo ho čtečka nepřečte. Na velikosti písmen nezáleží."
            />
            <div className="mt-5 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setManualOpen(false)}>
                Zrušit
              </Button>
              <Button className="flex-1" onClick={addManual} disabled={!manualCode.trim()}>
                Započítat
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-4">
              <Field
                label="Název zboží"
                autoFocus
                value={looseName}
                placeholder="např. Jablka volně"
                onChange={(e) => setLooseName(e.target.value)}
                hint="Pro zboží, které čárový kód vůbec nemá — vážené, rozbalené, vlastní výroba."
              />
              <Field
                label="Počet kusů"
                type="number"
                inputMode="numeric"
                min={1}
                value={looseQty}
                onChange={(e) => setLooseQty(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addLoose()}
                hint="Zadej rovnou celý počet — nemusíš klikat po jednom."
              />
            </div>
            <div className="mt-5 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setManualOpen(false)}>
                Zrušit
              </Button>
              <Button
                className="flex-1"
                onClick={addLoose}
                disabled={!looseName.trim() || !(Number(looseQty) > 0)}
              >
                Přidat
              </Button>
            </div>
          </>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        title="Smazat inventuru?"
        message={`Nenávratně smaže „${session.name}" i s tím, co je napočítané (${entries(lines.length)}). Naučené názvy zboží zůstanou.`}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await deleteSession(sessionId)
          navigate('/')
        }}
      />
    </div>
  )
}
