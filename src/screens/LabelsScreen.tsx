import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, isNoBarcode } from '../db'
import { downloadBlob } from '../lib/download'
import { kinds, sheets } from '../lib/czech'
import { PER_PAGE, labelPageCount } from '../lib/labels-layout'
import { Button, EmptyState } from '../components/ui'

/**
 * Printing QR labels for the catalog.
 *
 * Its own screen rather than a button on the protocol: labels are a job you do at a
 * desk before a stocktake, the protocol is what comes out of one. They share nothing
 * but the product list.
 */
export function LabelsScreen() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), [])

  const pages = labelPageCount(products?.length ?? 0)

  async function download() {
    if (!products?.length) return
    setBusy(true)
    setError(null)
    try {
      // Lazily imported for the same reason as the protocol: jsPDF and the embedded
      // font are a third of the app's code and are needed once in a blue moon. The
      // service worker precaches the chunk, so this still works with no signal.
      const { buildLabelsPdf, labelsFileName } = await import('../lib/labels')
      const blob = await buildLabelsPdf(products.map((p) => ({ code: p.code, name: p.name })))
      downloadBlob(blob, labelsFileName())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Štítky se nepodařilo vytvořit.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-5 pb-16 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <Link to="/" className="-ml-2 inline-block rounded-lg px-2 py-1 text-slate-600">
        ‹ Inventury
      </Link>
      <h1 className="mb-6 mt-1 text-2xl font-bold">Štítky</h1>

      {products?.length === 0 ? (
        <EmptyState title="Zatím není co tisknout">
          Nejdřív načti zboží z tabulky v Nastavení, nebo naskenuj a pojmenuj pár kódů.
        </EmptyState>
      ) : (
        <>
          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="font-semibold">Vytisknout štítky</h2>
            <p className="mt-1 text-sm text-slate-500">
              Ke každému zboží v katalogu jeden štítek: QR kód a pod ním kód a název.
              Naskenuješ ho pak stejně jako čárový kód na zboží.
            </p>
            <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              {kinds(products?.length ?? 0)} zboží — {sheets(pages)} A4, {PER_PAGE} štítků na
              stranu.
            </p>
            <Button className="mt-4 w-full" onClick={download} disabled={busy}>
              {busy ? 'Vytvářím…' : 'Stáhnout štítky (PDF)'}
            </Button>
            {error && (
              <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
            <p className="mt-3 text-xs text-slate-500">
              Tiskni ve <strong>skutečné velikosti</strong> („100 %", ne „přizpůsobit stránce") —
              zmenšený QR kód se hůř čte. Slabé čáry jsou na stříhání.
            </p>
          </section>

          <section className="mt-6">
            <h2 className="mb-3 font-semibold">Co se vytiskne</h2>
            <ul className="space-y-2">
              {products?.map((product) => (
                <li
                  key={product.code}
                  className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{product.name}</p>
                    {/* The synthetic id of loose goods is never shown — see db.ts. */}
                    {isNoBarcode(product.code) ? (
                      <p className="truncate text-xs italic text-slate-400">
                        bez kódu — na štítku bude jen název
                      </p>
                    ) : (
                      <p className="truncate font-mono text-xs text-slate-500">{product.code}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
