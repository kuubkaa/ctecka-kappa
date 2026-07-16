import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { createSession, db, getSettings } from '../db'
import { entries, pieces } from '../lib/czech'
import { Button, Dialog, EmptyState, Field } from '../components/ui'

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' })

function defaultName() {
  return `Inventura ${new Date().toLocaleDateString('cs-CZ', { dateStyle: 'medium' })}`
}

export function HomeScreen() {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', place: '', handoverFrom: '', handoverTo: '' })

  const sessions = useLiveQuery(() => db.sessions.orderBy('startedAt').reverse().toArray(), [])
  // One query for all counts beats one per row — a long list would otherwise
  // fire dozens of reads on every render.
  const counts = useLiveQuery(async () => {
    const items = await db.items.toArray()
    const map = new Map<number, { lines: number; pieces: number }>()
    for (const item of items) {
      const entry = map.get(item.sessionId) ?? { lines: 0, pieces: 0 }
      entry.lines += 1
      entry.pieces += item.qty
      map.set(item.sessionId, entry)
    }
    return map
  }, [])

  async function openCreate() {
    const settings = await getSettings()
    setForm({ name: defaultName(), place: settings.defaultPlace, handoverFrom: '', handoverTo: '' })
    setCreating(true)
  }

  async function submit() {
    const id = await createSession({
      name: form.name.trim() || defaultName(),
      place: form.place.trim(),
      handoverFrom: form.handoverFrom.trim(),
      handoverTo: form.handoverTo.trim(),
    })
    setCreating(false)
    navigate(`/inventura/${id}`)
  }

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col">
      <header className="order-1 flex items-center justify-between px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-bold">Inventury</h1>
        <Link to="/nastaveni" className="rounded-xl px-3 py-2 text-slate-600 active:bg-slate-200">
          Nastavení
        </Link>
      </header>

      <main className="order-2 flex-1 px-5 md:order-3 md:pt-4">
        {sessions?.length === 0 && (
          <EmptyState title="Zatím žádná inventura">
            Založ novou inventuru a začni skenovat čárové kódy.
          </EmptyState>
        )}

        <ul className="space-y-3">
          {sessions?.map((session) => {
            const count = counts?.get(session.id)
            return (
              <li key={session.id}>
                <Link
                  to={`/inventura/${session.id}`}
                  className="block rounded-2xl bg-white p-4 shadow-sm active:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{session.name}</p>
                      <p className="mt-0.5 truncate text-sm text-slate-500">
                        {session.place || 'bez místa'} · {fmtDate(session.startedAt)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                        session.closedAt
                          ? 'bg-slate-200 text-slate-600'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {session.closedAt ? 'Ukončeno' : 'Probíhá'}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    {count
                      ? `${entries(count.lines)} · ${pieces(count.pieces)}`
                      : 'zatím nic naskenováno'}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      </main>

      {/* Bottom bar on a phone (thumb reach), under the header on a desktop — see
          the note in SessionScreen. */}
      <div className="order-3 sticky bottom-0 bg-gradient-to-t from-slate-100 via-slate-100 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:static md:order-2 md:bg-none md:px-5 md:py-0">
        <Button className="w-full text-lg md:w-auto" onClick={openCreate}>
          Nová inventura
        </Button>
      </div>

      <Dialog open={creating} title="Nová inventura" onClose={() => setCreating(false)}>
        <div className="space-y-4">
          <Field
            label="Název"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Field
            label="Místo / sklad"
            value={form.place}
            onChange={(e) => setForm({ ...form, place: e.target.value })}
          />
          <Field
            label="Předávající"
            hint="Objeví se na protokolu u podpisu. Můžeš doplnit později."
            value={form.handoverFrom}
            onChange={(e) => setForm({ ...form, handoverFrom: e.target.value })}
          />
          <Field
            label="Přebírající"
            value={form.handoverTo}
            onChange={(e) => setForm({ ...form, handoverTo: e.target.value })}
          />
        </div>
        <div className="mt-5 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setCreating(false)}>
            Zrušit
          </Button>
          <Button className="flex-1" onClick={submit}>
            Založit
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
