// Point the ponyfill at the .wasm we bundle, so scanning works with no network.
// Vite's ?url import emits the file into dist/ and the service worker caches it.
// Do NOT copy this to public/ — the .wasm and its JS glue are version-locked and a
// mismatch fails at runtime with an opaque "invalid index".
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill'

/**
 * We use the ponyfill on every platform rather than feature-detecting the native
 * BarcodeDetector, deliberately:
 *   - iOS has never shipped it (flag-gated since 17, and broken when enabled).
 *   - Android's native one needs Google Play Services and downloads a module first run.
 * One engine everywhere means one set of behaviours to support.
 */
export const FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'itf',
  'qr_code',
] as const

let modulePrepared = false

/** Loads the ~1 MB scanner engine. Called at app boot so the first scan isn't slow. */
export function warmUpScanner(): void {
  if (modulePrepared) return
  modulePrepared = true
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? wasmUrl : prefix + path,
    },
    fireImmediately: true,
  })
}

export function createDetector(): BarcodeDetector {
  warmUpScanner()
  return new BarcodeDetector({ formats: [...FORMATS] })
}

/**
 * Whether a viewfinder is on screen right now.
 *
 * Nothing may interrupt scanning: the user is up a ladder pointing a phone at a
 * shelf, and a dialog over the camera at that moment is worse than useless. A
 * counter rather than a boolean, so a remount can't leave it stuck on.
 */
let openScanners = 0
export const isScannerOpen = () => openScanners > 0
export function markScannerOpen(): () => void {
  openScanners++
  return () => {
    openScanners--
  }
}

export class CameraError extends Error {
  constructor(
    message: string,
    readonly kind: 'denied' | 'notfound' | 'insecure' | 'other',
  ) {
    super(message)
  }
}

/** True when the browser will even offer us a camera. Plain HTTP silently has no API. */
export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

/**
 * Opens the rear camera.
 *
 * MUST be called synchronously from a user gesture. Without one, iOS gives a
 * 1-minute permission window instead of 10, which shows up as scanning that
 * mysteriously dies after a minute or two.
 */
export async function openCamera(): Promise<MediaStream> {
  if (!cameraSupported()) {
    throw new CameraError(
      window.isSecureContext
        ? 'Tento prohlížeč neumí pracovat s fotoaparátem.'
        : 'Fotoaparát je dostupný jen přes zabezpečené spojení (https).',
      window.isSecureContext ? 'other' : 'insecure',
    )
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    })
  } catch (err) {
    const name = err instanceof DOMException ? err.name : ''
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new CameraError('Přístup k fotoaparátu byl zamítnutý.', 'denied')
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new CameraError('Nenašel jsem žádný fotoaparát.', 'notfound')
    }
    throw new CameraError('Fotoaparát se nepodařilo spustit.', 'other')
  }
}

export function stopCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop())
}

/** Torch is a post-hoc constraint; asking for it in getUserMedia fails on some devices. */
export async function setTorch(stream: MediaStream | null, on: boolean): Promise<boolean> {
  const track = stream?.getVideoTracks()[0]
  if (!track) return false
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] })
    return true
  } catch {
    return false
  }
}

export function torchAvailable(stream: MediaStream | null): boolean {
  const track = stream?.getVideoTracks()[0]
  if (!track) return false
  return 'torch' in (track.getCapabilities?.() ?? {})
}
