import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getSettings, renameProduct, saveSettings } from '../db'
import { ConfirmDialog, EmptyState, Field } from '../components/ui'

export function SettingsScreen() {
  const [company, setCompany] = useState('')
  const [defaultPlace, setDefaultPlace] = useState('')
  const [saved, setSaved] = useState(false)
  const [deleteCode, setDeleteCode] = useState<string | null>(null)

  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), [])

  useEffect(() => {
    void getSettings().then((s) => {
      setCompany(s.company)
      setDefaultPlace(s.defaultPlace)
    })
  }, [])

  async function persist(patch: { company?: string; defaultPlace?: string }) {
    await saveSettings(patch)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
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
        <p className={`text-sm text-emerald-600 transition-opacity ${saved ? '' : 'opacity-0'}`}>
          Uloženo
        </p>
      </section>

      <section className="mt-6">
        <h2 className="mb-1 font-semibold">Naučené zboží</h2>
        <p className="mb-4 text-sm text-slate-500">
          Kódy, které jsi pojmenoval. Platí napříč všemi inventurami.
        </p>

        {products?.length === 0 ? (
          <EmptyState title="Zatím nic naučeného">
            Až naskenuješ neznámý kód, aplikace se zeptá na název a uloží ho sem.
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
