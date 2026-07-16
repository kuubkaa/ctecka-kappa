import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CameraError,
  createDetector,
  openCamera,
  setTorch,
  stopCamera,
  torchAvailable,
} from '../lib/scanner'

/** Ignore the same code for this long, so one barcode held in frame counts once. */
const RESCAN_COOLDOWN_MS = 1200
/** ~8 detections/sec. Faster drains battery without catching more barcodes. */
const DETECT_INTERVAL_MS = 125

interface Props {
  onDetect: (code: string) => void
  onClose: () => void
  /** Rendered over the viewfinder — the running count, last item, etc. */
  status?: React.ReactNode
  /** Pauses detection while a dialog is open, without tearing the camera down. */
  paused?: boolean
}

function feedback() {
  navigator.vibrate?.(60)
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
    osc.start()
    osc.stop(ctx.currentTime + 0.12)
    osc.onended = () => void ctx.close()
  } catch {
    // Audio is a nicety; a blocked AudioContext must never stop the scan.
  }
}

export function Scanner({ onDetect, onClose, status, paused = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const lastHitRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  const pausedRef = useRef(paused)
  const onDetectRef = useRef(onDetect)

  const [error, setError] = useState<CameraError | null>(null)
  const [ready, setReady] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [hasTorch, setHasTorch] = useState(false)

  pausedRef.current = paused
  onDetectRef.current = onDetect

  /**
   * iOS bug 310349: after backgrounding, locking, or rotating, the preview can go
   * black while the track still reports `active` — so there is nothing to detect
   * and no error to catch. Re-attaching the stream is the only known fix.
   */
  const reattach = useCallback(() => {
    const video = videoRef.current
    const stream = streamRef.current
    if (!video || !stream) return
    video.srcObject = null
    video.srcObject = stream
    void video.play().catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    async function start() {
      try {
        // openCamera runs first and synchronously enough to keep the user gesture
        // that mounted this component — see the 10s vs 1min window on iOS.
        const stream = await openCamera()
        if (cancelled) {
          stopCamera(stream)
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play().catch(() => {})
        setReady(true)
        setHasTorch(torchAvailable(stream))

        const detector = createDetector()
        let busy = false

        timer = window.setInterval(async () => {
          if (busy || pausedRef.current || cancelled) return
          if (video.readyState < video.HAVE_CURRENT_DATA) return
          busy = true
          try {
            const found = await detector.detect(video)
            const code = found[0]?.rawValue?.trim()
            if (code) {
              const last = lastHitRef.current
              const now = Date.now()
              if (code !== last.code || now - last.at > RESCAN_COOLDOWN_MS) {
                lastHitRef.current = { code, at: now }
                feedback()
                onDetectRef.current(code)
              }
            }
          } catch {
            // A single bad frame is normal; keep the loop alive.
          } finally {
            busy = false
          }
        }, DETECT_INTERVAL_MS)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof CameraError ? err : new CameraError('Fotoaparát selhal.', 'other'))
        }
      }
    }

    void start()
    document.addEventListener('visibilitychange', reattach)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', reattach)
      stopCamera(streamRef.current)
      streamRef.current = null
    }
  }, [reattach])

  async function toggleTorch() {
    const next = !torchOn
    if (await setTorch(streamRef.current, next)) setTorchOn(next)
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-900 p-6 text-center">
        <p className="text-lg font-medium text-white">{error.message}</p>
        {error.kind === 'denied' && (
          <p className="text-sm text-slate-400">
            Povol přístup k fotoaparátu v nastavení prohlížeče a zkus to znovu.
          </p>
        )}
        {error.kind === 'insecure' && (
          <p className="text-sm text-slate-400">
            Otevři aplikaci přes adresu začínající https://
          </p>
        )}
        <button
          onClick={onClose}
          className="mt-2 rounded-xl bg-white px-6 py-3 font-medium text-slate-900"
        >
          Zpět
        </button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        playsInline
        muted
        autoPlay
      />

      {/* Viewfinder */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-40 w-[85%] max-w-sm rounded-2xl border-2 border-white/80 shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]" />
      </div>

      {!ready && (
        <p className="absolute inset-x-0 top-1/2 text-center text-white">Spouštím fotoaparát…</p>
      )}

      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button
          onClick={onClose}
          className="rounded-full bg-black/60 px-5 py-2.5 font-medium text-white backdrop-blur"
        >
          Hotovo
        </button>
        {hasTorch && (
          <button
            onClick={toggleTorch}
            aria-pressed={torchOn}
            className={`rounded-full px-5 py-2.5 font-medium backdrop-blur ${
              torchOn ? 'bg-amber-400 text-slate-900' : 'bg-black/60 text-white'
            }`}
          >
            {torchOn ? 'Světlo zap.' : 'Světlo'}
          </button>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {status}
      </div>
    </div>
  )
}
