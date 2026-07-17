import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { exportBackup, backupFileName } from '../lib/backup'
import { downloadBlob } from '../lib/download'
import { markBackedUp, needsBackup } from '../db'
import { isScannerOpen } from '../lib/scanner'
import { Button, Dialog } from './ui'

/**
 * Nags about backing up — the file is the only copy that survives a lost phone.
 *
 * Two rules keep it from becoming wallpaper:
 *
 * 1. It only appears when something has actually been counted since the last
 *    backup. A box that fires with nothing to save teaches people to dismiss it
 *    without reading, and then it's useless on the day it matters.
 * 2. Once dismissed, it stays quiet for a while. Reappearing on every screen change
 *    would make the app unusable, and a nag people fight is a nag people defeat.
 *
 * It also does the backup itself rather than pointing at Settings: a reminder that
 * makes you go and find the thing is a reminder you postpone.
 */
const SNOOZE_KEY = 'ctecka-kappa:backup-reminder-snoozed-until'
const SNOOZE_MS = 6 * 60 * 60 * 1000
/** Long enough that the reminder never lands mid-scan. */
const FIRST_CHECK_DELAY_MS = 2_000

function snoozedUntil(): number {
  const raw = localStorage.getItem(SNOOZE_KEY)
  const at = raw ? Number(raw) : 0
  return Number.isFinite(at) ? at : 0
}

export function BackupReminder() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      if (cancelled || Date.now() < snoozedUntil()) return
      // Never over the camera, and never on top of a decision the user is already
      // making — a box that lands mid-scan is worse than no reminder at all.
      if (isScannerOpen() || document.querySelector('dialog[open]')) return
      if (await needsBackup()) setOpen(true)
    }
    const timer = setTimeout(check, FIRST_CHECK_DELAY_MS)
    // Also when the app comes back to the foreground — that's when someone has
    // finished counting and put the phone down, which is exactly the moment.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  function snooze() {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS))
    setOpen(false)
  }

  async function backupNow() {
    setBusy(true)
    try {
      const backup = await exportBackup()
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      downloadBlob(blob, backupFileName())
      await markBackedUp()
      setDone(true)
      // Long enough to read the confirmation, short enough not to be in the way.
      setTimeout(() => {
        setOpen(false)
        setDone(false)
      }, 2200)
    } catch {
      // Send them somewhere they can retry by hand rather than leaving a dead box.
      setOpen(false)
      navigate('/nastaveni')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} title={done ? 'Záloha stažena' : 'Zálohuj si inventuru'} onClose={snooze}>
      {done ? (
        <p className="text-slate-600">
          Soubor máš ve Stažených souborech. Ulož si ho někam bokem — třeba na NAS
          nebo do mailu.
        </p>
      ) : (
        <>
          <p className="mb-2 text-slate-600">
            Od poslední zálohy jsi něco napočítal. <strong>Data jsou jen v tomhle
            zařízení</strong> — když o něj přijdeš, přijdeš i o inventury.
          </p>
          <p className="mb-5 text-sm text-slate-500">
            Záloha se stáhne jako soubor. Přes něj ji taky dostaneš na počítač.
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={snooze} disabled={busy}>
              Teď ne
            </Button>
            <Button className="flex-1" onClick={backupNow} disabled={busy}>
              {busy ? 'Zálohuji…' : 'Zálohovat'}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}
