import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getSettings, importCatalog, markBackedUp, renameProduct, saveSettings } from '../db'
import {
  BackupError,
  backupFileName,
  exportBackup,
  importBackup,
  parseBackup,
  type Backup,
} from '../lib/backup'
import { CatalogError, fetchCatalog, type CatalogPreview } from '../lib/catalog'
import { downloadBlob } from '../lib/download'
import { entries, kinds, stocktakes } from '../lib/czech'
import { Button, ConfirmDialog, Dialog, EmptyState, Field } from '../components/ui'

export function SettingsScreen() {
  const [company, setCompany] = useState('')
  const [defaultPlace, setDefaultPlace] = useState('')
  const [saved, setSaved] = useState(false)
  const [deleteCode, setDeleteCode] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Backup | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [catalogUrl, setCatalogUrl] = useState('')
  const [catalogLoadedAt, setCatalogLoadedAt] = useState<number | undefined>()
  const [catalogPreview, setCatalogPreview] = useState<CatalogPreview | null>(null)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [catalogNotice, setCatalogNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null,
  )
  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), [])
  useEffect(() => {
    void getSettings().then((s) => {
      setCompany(s.company)
      setDefaultPlace(s.defaultPlace)
      setCatalogUrl(s.catalogUrl ?? '')
      setCatalogLoadedAt(s.catalogLoadedAt)
    })
  }, [])

  /** Fetch and show — never import straight from the button. See the dialog below. */
  async function loadCatalog() {
    setCatalogBusy(true)
    setCatalogNotice(null)
    try {
      setCatalogPreview(await fetchCatalog(catalogUrl))
    } catch (err) {
      setCatalogNotice({
        kind: 'err',
        text: err instanceof CatalogError ? err.message : 'Tabulku se nepodařilo přečíst.',
      })
    } finally {
      setCatalogBusy(false)
    }
  }

  async function doImportCatalog() {
    if (!catalogPreview) return
    const { rows } = catalogPreview
    setCatalogPreview(null)
    setCatalogBusy(true)
    try {
      const res = await importCatalog(rows)
      const at = Date.now()
      await saveSettings({ catalogLoadedAt: at })
      setCatalogLoadedAt(at)
      setCatalogNotice({
        kind: 'ok',
        text: res.added || res.renamed
          ? `Načteno: ${kinds(res.added)} nového zboží, ${res.renamed} přejmenovaného.`
          : 'Hotovo — v tabulce nebylo nic nového.',
      })
    } catch {
      setCatalogNotice({ kind: 'err', text: 'Zboží se nepodařilo uložit. Data zůstala beze změny.' })
    } finally {
      setCatalogBusy(false)
    }
  }

  async function persist(patch: { company?: string; defaultPlace?: string }) {
    await saveSettings(patch)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  async function doExport() {
    setBusy(true)
    setNotice(null)
    try {
      const backup = await exportBackup()
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      downloadBlob(blob, backupFileName())
      await markBackedUp()
      setNotice({
        kind: 'ok',
        text: `Záloha stažena — ${stocktakes(backup.sessions.length)}, ${entries(backup.items.length)}.`,
      })
    } catch {
      setNotice({ kind: 'err', text: 'Zálohu se nepodařilo vytvořit.' })
    } finally {
      setBusy(false)
    }
  }

  /** Parse before asking: a broken file should say so instead of opening a dialog. */
  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // so picking the same file twice fires again
    if (!file) return
    setNotice(null)
    try {
      setPending(parseBackup(await file.text()))
    } catch (err) {
      setNotice({
        kind: 'err',
        text: err instanceof BackupError ? err.message : 'Soubor se nepodařilo přečíst.',
      })
    }
  }

  async function doImport() {
    if (!pending) return
    const backup = pending
    setPending(null)
    setBusy(true)
    try {
      const added = await importBackup(backup)
      setNotice({
        kind: 'ok',
        text: `Načteno: ${stocktakes(added.sessions)}, ${entries(added.items)}, ${kinds(added.products)} zboží.`,
      })
    } catch {
      setNotice({ kind: 'err', text: 'Zálohu se nepodařilo načíst. Data zůstala beze změny.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-5 pb-16 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <Link to="/" className="-ml-2 inline-block rounded-lg px-2 py-1 text-slate-600">
        ‹ Inventury
      </Link>
      <h1 className="mb-6 mt-1 text-2xl font-bold">Nastavení</h1>

      <section className="space-y-4 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Hlavička protokolu</h2>
        <Field
          label="Název firmy"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          onBlur={() => persist({ company })}
          hint="Vytiskne se vpravo nahoře na předávacím protokolu."
        />
        <Field
          label="Výchozí místo / sklad"
          value={defaultPlace}
          onChange={(e) => setDefaultPlace(e.target.value)}
          onBlur={() => persist({ defaultPlace })}
          hint="Předvyplní se u každé nové inventury."
        />
        {/* Rendered only when true. It used to be always present at opacity-0, which
            reads as "visible" to a test — so anything waiting for the save to land
            passed instantly and verified nothing. */}
        <p className="h-5 text-sm text-emerald-600">{saved ? 'Uloženo' : ''}</p>
      </section>

      <section className="mt-6 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Záloha</h2>
        <p className="mt-1 mb-4 text-sm text-slate-500">
          Data žijí jen v tomhle telefonu. Když o něj přijdeš, přijdeš i o inventury —
          zálohu si občas ulož někam bokem.
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={doExport} disabled={busy}>
            Zálohovat
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            Načíst zálohu
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={pickFile}
          className="hidden"
          aria-label="Vybrat soubor se zálohou"
        />
        {notice && (
          <p
            role="status"
            className={`mt-3 rounded-xl p-3 text-sm ${
              notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
            }`}
          >
            {notice.text}
          </p>
        )}
      </section>

      <section className="mt-6 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Zboží z tabulky</h2>
        <p className="mt-1 mb-4 text-sm text-slate-500">
          Když si zboží vypíšeš do Google tabulky, aplikace se při skenování nebude ptát na
          názvy. <strong>První sloupec čárový kód, druhý název.</strong> Čte se první list.
        </p>
        <Field
          label="Odkaz na tabulku"
          type="url"
          inputMode="url"
          placeholder="https://docs.google.com/spreadsheets/…"
          value={catalogUrl}
          onChange={(e) => setCatalogUrl(e.target.value)}
          // Saved on blur rather than on a successful load: the link is tedious to paste
          // on a phone, and losing it because the signal dropped mid-fetch would be a
          // pointless retype. A wrong link stored is just a text field to correct.
          onBlur={() => void saveSettings({ catalogUrl: catalogUrl.trim() })}
          hint="V tabulce dej Sdílet → Kdokoli s odkazem → Čtenář, pak Kopírovat odkaz."
        />
        <Button
          variant="secondary"
          className="mt-4 w-full"
          onClick={loadCatalog}
          disabled={catalogBusy || !catalogUrl.trim()}
        >
          {catalogBusy ? 'Načítám…' : 'Načíst zboží z tabulky'}
        </Button>
        {/* Stale-vs-fresh is the whole question when there's no sync: the sheet may have
            moved on since this phone last looked, and only the user knows if that matters. */}
        {catalogLoadedAt && (
          <p className="mt-3 text-xs text-slate-500">
            Naposledy načteno {new Date(catalogLoadedAt).toLocaleString('cs-CZ')}. Načti znovu,
            když tabulku změníš — samo se to neaktualizuje.
          </p>
        )}
        <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
          Stahuje se jen jedním směrem. Z telefonu do tabulky neodejde nic — ani inventury, ani
          jména z protokolu. Potřebuje internet, takže si zboží načti dřív, než vyrazíš do skladu.
        </p>
        {catalogNotice && (
          <p
            role="status"
            className={`mt-3 rounded-xl p-3 text-sm ${
              catalogNotice.kind === 'ok'
                ? 'bg-emerald-50 text-emerald-800'
                : 'bg-red-50 text-red-700'
            }`}
          >
            {catalogNotice.text}
          </p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-1 font-semibold">Naučené zboží</h2>
        <p className="mb-4 text-sm text-slate-500">
          Kódy, které jsi pojmenoval nebo načetl z tabulky. Platí napříč všemi inventurami.
        </p>

        {products?.length === 0 ? (
          <EmptyState title="Zatím nic naučeného">
            Načti zboží z tabulky, nebo naskenuj neznámý kód — aplikace se zeptá na název a
            uloží ho sem.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {products?.map((product) => (
              <li
                key={product.code}
                className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <input
                    defaultValue={product.name}
                    onBlur={(e) => {
                      const next = e.target.value.trim()
                      if (next && next !== product.name) void renameProduct(product.code, next)
                    }}
                    className="w-full rounded-lg bg-transparent px-1 py-0.5 font-medium outline-none focus:bg-slate-100"
                  />
                  {product.noBarcode ? (
                    <p className="truncate px-1 text-xs italic text-slate-400">
                      bez čárového kódu
                    </p>
                  ) : (
                    <p className="truncate px-1 font-mono text-xs text-slate-500">{product.code}</p>
                  )}
                </div>
                <button
                  aria-label={`Zapomenout ${product.name}`}
                  onClick={() => setDeleteCode(product.code)}
                  className="shrink-0 rounded-lg px-3 py-2 text-sm text-slate-500 active:bg-slate-100"
                >
                  Zapomenout
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={pending !== null} title="Načíst zálohu?" onClose={() => setPending(null)}>
        <p className="mb-3 text-slate-600">Záloha obsahuje:</p>
        <ul className="mb-4 space-y-1 text-sm text-slate-700">
          <li>• {stocktakes(pending?.sessions.length ?? 0)}</li>
          <li>• {entries(pending?.items.length ?? 0)}</li>
          <li>• {kinds(pending?.products.length ?? 0)} naučeného zboží</li>
          {pending && (
            <li className="text-slate-500">
              • pořízeno {new Date(pending.exportedAt).toLocaleString('cs-CZ')}
            </li>
          )}
        </ul>
        <p className="mb-5 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
          Nic se nepřepíše ani nesmaže — inventury ze zálohy se <strong>přidají</strong> k těm,
          co tu už jsou. Když zálohu načteš dvakrát, budeš je mít dvakrát.
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setPending(null)}>
            Zrušit
          </Button>
          <Button className="flex-1" onClick={doImport}>
            Načíst
          </Button>
        </div>
      </Dialog>

      {/*
        The preview is not a formality — it is the only thing standing between the user
        and silently wrong data. Google answers an unrecognised gid or sheet name by
        serving the *first* tab with HTTP 200, so "wrong tab" and "columns the other way
        round" both arrive looking exactly like success. Nobody can check a barcode, but
        everybody spots that the list says Alexandra instead of Jablka.
      */}
      <Dialog
        open={catalogPreview !== null}
        title="Sedí to?"
        onClose={() => setCatalogPreview(null)}
      >
        <p className="mb-3 text-slate-600">
          Z tabulky jsem přečetl {kinds(catalogPreview?.rows.length ?? 0)} zboží. Zkontroluj,
          že je to opravdu ono:
        </p>
        <ul className="mb-4 divide-y divide-slate-100 rounded-xl bg-slate-50 p-3 text-sm">
          {catalogPreview?.rows.slice(0, 5).map((row) => (
            <li key={row.code} className="py-1.5 first:pt-0 last:pb-0">
              <span className="font-medium text-slate-800">{row.name}</span>
              <span className="ml-2 font-mono text-xs text-slate-500">{row.code}</span>
            </li>
          ))}
          {(catalogPreview?.rows.length ?? 0) > 5 && (
            <li className="py-1.5 text-slate-500">
              …a další {(catalogPreview?.rows.length ?? 0) - 5}
            </li>
          )}
        </ul>
        {!!catalogPreview?.skipped && (
          <p className="mb-4 text-sm text-amber-700">
            {entries(catalogPreview.skipped)} jsem přeskočil — chyběl kód nebo název.
          </p>
        )}
        <p className="mb-5 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
          Nic se nesmaže a napočítané kusy zůstanou. Zboží se <strong>přidá</strong>, a kde
          tabulka říká jiný název než aplikace, přepíše ho tabulka.
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setCatalogPreview(null)}>
            Zrušit
          </Button>
          <Button className="flex-1" onClick={doImportCatalog}>
            Načíst
          </Button>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleteCode !== null}
        title="Zapomenout zboží?"
        message="Aplikace zapomene název tohoto kódu. Už napočítané kusy v inventurách zůstanou, ale u položky se místo názvu ukáže jen kód."
        confirmLabel="Zapomenout"
        onCancel={() => setDeleteCode(null)}
        onConfirm={async () => {
          if (deleteCode) await db.products.delete(deleteCode)
          setDeleteCode(null)
        }}
      />
    </div>
  )
}
