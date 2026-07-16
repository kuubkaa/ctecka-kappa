import { useCallback, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  deleteSession,
  getLines,
  getSettings,
  nameAndCount,
  recordScan,
  renameProduct,
  setQty,
  type Line,
} from '../db'
import { entries, pieceWord, pieces } from '../lib/czech'
import { primeAudio } from '../lib/feedback'
import { Scanner, type ScanOutcomeKind } from '../components/Scanner'
import { Button, ConfirmDialog, Dialog, EmptyState, Field } from '../components/ui'

export function SessionScreen() {
  const { id } = useParams()
  const sessionId = Number(id)
  const navigate = useNavigate()

  const [scanning, setScanning] = useState(false)
  const [unknownCode, setUnknownCode] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  // `seq` re-keys the confirmation card so its pop animation replays on every scan.
  const [lastScan, setLastScan] = useState<{ name: string; qty: number; seq: number } | null>(null)
  const [editing, setEditing] = useState<Line | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editName, setEditName] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const session = useLiveQuery(() => db.sessions.get(sessionId), [sessionId])
  const lines = useLiveQuery(() => getLines(sessionId), [sessionId]) ?? []

  const totalPieces = lines.reduce((sum, l) => sum + l.qty, 0)

  const handleDetect = useCallback(
    async (code: string): Promise<ScanOutcomeKind> => {
      const outcome = await recordScan(sessionId, code)
      if (outcome.kind === 'unknown') {
        setNewName('')
        setUnknownCode(code) // Pauses the scanner until the user names it.
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

  async function addManual() {
    const code = manualCode.trim()
    if (!code) return
    setManualOpen(false)
    setManualCode('')
    await handleDetect(code)
  }

  function openEdit(line: Line) {
    setEditing(line)
    setEditQty(String(line.qty))
    setEditName(line.name)
  }

  async function saveEdit() {
    if (!editing) return
    const qty = Number(editQty)
    if (Number.isFinite(qty)) await setQty(editing.itemId, Math.max(0, Math.trunc(qty)))
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
      <header className="px-5 pb-3 pt-[max(1.25rem,env(safe-area-inset-top))]">
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

      <main className="flex-1 px-5 pb-4">
        {lines.length === 0 ? (
          <EmptyState title="Zatím nic naskenováno">
            Stiskni Skenovat a namiř fotoaparát na čárový kód.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {lines.map((line) => (
              <li
                key={line.itemId}
                className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm"
              >
                <button
                  onClick={() => openEdit(line)}
                  className="min-w-0 flex-1 text-left active:opacity-60"
                >
                  <p className="truncate font-medium">{line.name}</p>
                  <p className="truncate font-mono text-xs text-slate-500">{line.code}</p>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    aria-label={`Ubrat ${line.name}`}
                    onClick={() => setQty(line.itemId, line.qty - 1)}
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
                    onClick={() => setQty(line.itemId, line.qty + 1)}
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

      <div className="sticky bottom-0 flex gap-3 bg-gradient-to-t from-slate-100 via-slate-100 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <Button variant="secondary" onClick={() => setManualOpen(true)}>
          Ručně
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

      <Dialog open={unknownCode !== null} title="Nové zboží">
        <p className="mb-1 text-sm text-slate-600">Tenhle kód ještě neznám:</p>
        <p className="mb-4 font-mono text-sm font-medium">{unknownCode}</p>
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

      <Dialog open={manualOpen} title="Zadat kód ručně" onClose={() => setManualOpen(false)}>
        <Field
          label="Čárový kód"
          autoFocus
          inputMode="numeric"
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addManual()}
          hint="Když je kód poškozený a nejde načíst."
        />
        <div className="mt-5 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setManualOpen(false)}>
            Zrušit
          </Button>
          <Button className="flex-1" onClick={addManual} disabled={!manualCode.trim()}>
            Započítat
          </Button>
        </div>
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
