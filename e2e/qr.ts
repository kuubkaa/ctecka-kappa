import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { prepareZXingModule, writeBarcode } from 'zxing-wasm/writer'

/**
 * Generates QR codes for the scanner tests.
 *
 * Uses zxing's *writer* wasm, which is a separate module from the reader the app
 * bundles — this runs in Node, inside the test process, and never reaches the app
 * build. The app itself has no QR encoder and needs none: it only ever reads.
 */

// Decoded, not a URL path: this repo lives under a folder with Czech characters, and
// a percent-encoded path here fails to read. Same trap as the fake camera's .y4m.
const WRITER_WASM = fileURLToPath(
  new URL('../node_modules/zxing-wasm/dist/writer/zxing_writer.wasm', import.meta.url),
)

let prepared: Promise<unknown> | null = null

/** Loaded from disk rather than fetched — the suite must pass with no network. */
function prepare(): Promise<unknown> {
  prepared ??= readFile(WRITER_WASM).then((wasm) =>
    prepareZXingModule({
      overrides: { wasmBinary: wasm.buffer as ArrayBuffer },
      fireImmediately: true,
    }),
  )
  return prepared
}

/** A QR carrying `text`, as a PNG data URL a test can draw onto a canvas. */
export async function qrPngDataUrl(text: string): Promise<string> {
  await prepare()
  const result = await writeBarcode(text, { format: 'QRCode', scale: 8 })
  if (result.error || !result.image) {
    throw new Error(`QR se nepodařilo vygenerovat: ${result.error || 'bez obrázku'}`)
  }
  const png = Buffer.from(await result.image.arrayBuffer())
  return `data:image/png;base64,${png.toString('base64')}`
}
