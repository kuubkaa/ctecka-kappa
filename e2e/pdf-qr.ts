import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Reads the QR back out of a printed label.
 *
 * The QR is drawn as vector rectangles, so nothing downstream would notice if it came
 * out mirrored, off by a module, or scaled wrong — the PDF would still look like a QR
 * and simply never scan. Rasterising the page would need a canvas backend in Node; the
 * geometry is recoverable from the drawing operations instead.
 */

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Every filled rectangle on a page, in PDF points (origin bottom-left).
 *
 * jsPDF emits rect() as a closed polygon rather than the `re` operator, and pdfjs hands
 * back a flat path: [cmd, x, y, cmd, x, y, ...] with 0=moveTo, 1=lineTo, 4=closePath.
 * Only fills are collected — the cut guides are strokes, and text is showText.
 */
async function fillRects(path: string, pageNo: number): Promise<Rect[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await readFile(path)) }).promise
  const { fnArray, argsArray } = await (await doc.getPage(pageNo)).getOperatorList()

  const rects: Rect[] = []
  for (let i = 0; i < fnArray.length; i++) {
    if (fnArray[i] !== pdfjs.OPS.constructPath) continue
    const [paintOp, raw] = argsArray[i] as [number, unknown]
    if (paintOp !== pdfjs.OPS.fill) continue

    const flat = Array.from(
      (Array.isArray(raw) ? raw[0] : raw) as ArrayLike<number>,
    ) as number[]
    const xs: number[] = []
    const ys: number[] = []
    for (let k = 0; k < flat.length; ) {
      if (flat[k] === 4) {
        k += 1 // closePath carries no coordinates
        continue
      }
      xs.push(flat[k + 1]!)
      ys.push(flat[k + 2]!)
      k += 3
    }
    if (xs.length < 2) continue
    rects.push({
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
    })
  }
  return rects
}

/**
 * Samples the drawn QR back into a matrix, so it can be compared with what the encoder
 * produced.
 *
 * Calibrated off `expected`'s own dark bounding box rather than the label's coordinates:
 * the test then knows nothing about where on the page the QR sits or how big a module
 * is, which is precisely what it is supposed to be checking. Assumes one QR on the page.
 */
export async function qrMatrixFromPdf(
  path: string,
  expected: boolean[][],
  pageNo = 1,
): Promise<boolean[][]> {
  const rects = await fillRects(path, pageNo)
  if (!rects.length) throw new Error('V PDF není žádný vyplněný obdélník — QR se nenakreslil.')

  const n = expected.length
  let minRow = n
  let maxRow = -1
  let minCol = n
  let maxCol = -1
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!expected[r]![c]) continue
      minRow = Math.min(minRow, r)
      maxRow = Math.max(maxRow, r)
      minCol = Math.min(minCol, c)
      maxCol = Math.max(maxCol, c)
    }
  }

  const left = Math.min(...rects.map((r) => r.x0))
  const right = Math.max(...rects.map((r) => r.x1))
  const top = Math.max(...rects.map((r) => r.y1)) // PDF y grows upwards
  const module = (right - left) / (maxCol - minCol + 1)

  const out: boolean[][] = []
  for (let r = 0; r < n; r++) {
    const row: boolean[] = []
    for (let c = 0; c < n; c++) {
      // Sample the middle of each module: a corner would sit exactly on a boundary and
      // make the result depend on rounding.
      const x = left + (c - minCol + 0.5) * module
      const y = top - (r - minRow + 0.5) * module
      row.push(rects.some((t) => x > t.x0 && x < t.x1 && y > t.y0 && y < t.y1))
    }
    out.push(row)
  }
  return out
}
