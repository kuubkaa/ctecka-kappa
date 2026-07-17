import type { jsPDF } from 'jspdf'
import { encode } from 'uqr'
import { FONT_FAMILY, createPdfDoc, fitText, renderable } from './pdf-font'
import { COLS, LABEL_H, LABEL_W, MARGIN, PAGE, PER_PAGE, ROWS } from './labels-layout'
import { isNoBarcode } from '../db'

/**
 * Printable QR labels for the catalog.
 *
 * Deliberately not part of the protocol: the protocol is a record of one stocktake
 * that people sign, labels are a workshop job you do once and repeat when goods
 * change. Bolting them together would mean printing labels to get a protocol.
 *
 * The QR is drawn as vector rectangles rather than a rasterised image, so it stays
 * sharp at any printer resolution — a blurry QR is a QR that doesn't scan.
 *
 * Everything is generated on the device. No QR web service sees the codes, and it
 * works with no signal, like the rest of the app.
 */

export interface LabelItem {
  code: string
  name: string
}

/** 24 mm is about the floor for a phone camera at arm's length in bad warehouse light. */
const QR_MM = 24
const PAD = 2.5

/**
 * Draws the QR at `size` mm square.
 *
 * `border: 4` is the quiet zone the QR spec requires — four modules of white on every
 * side. Without it a scanner cannot find the symbol, and since the border is part of
 * the returned matrix, scaling it here keeps that margin proportional at any size.
 *
 * Runs of dark modules are merged into single rectangles. A label is ~500 modules and
 * a page holds 28 of them; one rect per module makes a PDF several megabytes, which on
 * a phone is the difference between a file that opens and one that doesn't.
 */
function drawQr(doc: jsPDF, text: string, x: number, y: number, size: number): void {
  const { size: n, data } = encode(text, { border: 4, ecc: 'M' })
  const m = size / n
  doc.setFillColor(0, 0, 0)
  for (let row = 0; row < n; row++) {
    const cells = data[row]!
    let run = 0
    // <= n so a run reaching the right edge is still flushed.
    for (let col = 0; col <= n; col++) {
      if (col < n && cells[col]) {
        run++
        continue
      }
      if (run) {
        doc.rect(x + (col - run) * m, y + row * m, run * m, m, 'F')
        run = 0
      }
    }
  }
}

function drawLabel(doc: jsPDF, item: LabelItem, x: number, y: number): void {
  // The QR carries the code exactly as stored — that string is what the scanner
  // compares against the catalog, so anything prettier here would simply not match.
  drawQr(doc, item.code, x + (LABEL_W - QR_MM) / 2, y + PAD, QR_MM)

  let textY = y + PAD + QR_MM + 3.6
  const centre = x + LABEL_W / 2
  const maxW = LABEL_W - PAD * 2

  // Loose goods carry a synthetic internal id. Printing it would read as a real code
  // and send someone hunting for it on the shelf — the name is the only honest label.
  // The QR still holds the id, so the thing stays scannable.
  if (!isNoBarcode(item.code)) {
    doc.setFont(FONT_FAMILY, 'bold').setFontSize(8.5).setTextColor(0)
    doc.text(fitText(doc, item.code, maxW), centre, textY, { align: 'center' })
    textY += 3.6
  }

  doc.setFont(FONT_FAMILY, 'normal').setFontSize(7).setTextColor(90)
  doc.text(fitText(doc, item.name, maxW), centre, textY, { align: 'center' })
  doc.setTextColor(0)
}

/** Faint guides, printed on purpose: without them a plain-paper sheet is unscissorable. */
function drawCutGuides(doc: jsPDF): void {
  doc.setDrawColor(210).setLineWidth(0.1)
  for (let c = 0; c <= COLS; c++) {
    const x = MARGIN + c * LABEL_W
    doc.line(x, MARGIN, x, PAGE.h - MARGIN)
  }
  for (let r = 0; r <= ROWS; r++) {
    const y = MARGIN + r * LABEL_H
    doc.line(MARGIN, y, PAGE.w - MARGIN, y)
  }
}

export async function buildLabelsPdf(items: LabelItem[]): Promise<Blob> {
  if (!items.length) throw new Error('Není co tisknout — katalog je prázdný.')

  // Screened at the door, in one place, exactly like the protocol: a name jsPDF cannot
  // draw truncates the rest of the string silently. `code` is deliberately not
  // screened — it goes into the QR verbatim, and a '?' there would be a label that
  // scans as the wrong product.
  const clean = items.map((item) => ({ code: item.code, name: renderable(item.name) }))

  const doc = await createPdfDoc()

  clean.forEach((item, i) => {
    const slot = i % PER_PAGE
    if (i && slot === 0) doc.addPage()
    if (slot === 0) drawCutGuides(doc)
    drawLabel(
      doc,
      item,
      MARGIN + (slot % COLS) * LABEL_W,
      MARGIN + Math.floor(slot / COLS) * LABEL_H,
    )
  })

  return doc.output('blob')
}

/** Filenames end in .pdf on purpose: iOS types shared files by extension, not MIME. */
export function labelsFileName(at = new Date()): string {
  return `stitky-${at.toISOString().slice(0, 10)}.pdf`
}
