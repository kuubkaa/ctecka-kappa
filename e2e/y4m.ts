import { encodeEan13 } from './ean13'

/**
 * Renders a barcode into an uncompressed Y4M video, which Chromium can mount as a
 * fake camera (`--use-file-for-fake-video-capture`).
 *
 * That lets the suite drive the real path — camera stream, wasm decode, counting,
 * confirmation UI — instead of stopping at the manual-entry shortcut. Y4M is plain
 * enough to write by hand, so this needs no ffmpeg.
 *
 * Layout is I420: a full-size luma plane, then quarter-size U and V planes. The
 * barcode is pure black and white, so chroma stays neutral at 128 throughout.
 */

const WIDTH = 640
const HEIGHT = 480
const FPS = 25
/** Chromium loops the file; a few identical frames keep the barcode always in view. */
const FRAMES = 3

// Studio-swing luma. Full black/white (0/255) is out of range for C420 and some
// pipelines clamp it, which would only soften the edges the decoder needs.
const WHITE = 235
const BLACK = 16

export function barcodeY4m(code13: string): Buffer {
  const pattern = encodeEan13(code13)

  const moduleWidth = 6
  const barsWidth = pattern.length * moduleWidth // 95 modules -> 570 px
  const left = Math.floor((WIDTH - barsWidth) / 2) // quiet zone falls out of centring
  const barsHeight = 300
  const top = Math.floor((HEIGHT - barsHeight) / 2)

  const luma = Buffer.alloc(WIDTH * HEIGHT, WHITE)
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== '1') continue
    const x0 = left + i * moduleWidth
    for (let y = top; y < top + barsHeight; y++) {
      luma.fill(BLACK, y * WIDTH + x0, y * WIDTH + x0 + moduleWidth)
    }
  }

  const chromaSize = (WIDTH / 2) * (HEIGHT / 2)
  const u = Buffer.alloc(chromaSize, 128)
  const v = Buffer.alloc(chromaSize, 128)

  const header = Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F${FPS}:1 Ip A1:1 C420\n`, 'ascii')
  const frame = Buffer.concat([Buffer.from('FRAME\n', 'ascii'), luma, u, v])

  return Buffer.concat([header, ...Array.from({ length: FRAMES }, () => frame)])
}
