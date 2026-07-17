import autoTable from 'jspdf-autotable'
import { FONT_FAMILY, createPdfDoc, renderable } from './pdf-font'
import type { Line, Session, Settings } from '../db'

// Re-exported: callers of this module used it from here before the font setup moved
// out to be shared with the labels PDF.
export { renderable }

const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' })
const fmtNum = (n: number) => n.toLocaleString('cs-CZ')

export interface ProtocolInput {
  session: Session
  lines: Line[]
  settings: Settings
}

/** Builds the handover protocol. Returns a Blob so the caller decides save vs share. */
export async function buildProtocolPdf(input: ProtocolInput): Promise<Blob> {
  // Screen every user-supplied string in one place, at the door. Doing it per-call
  // downstream means the next doc.text() someone adds is one forgotten wrapper away
  // from silently truncating a product name.
  const session: Session = {
    ...input.session,
    name: renderable(input.session.name),
    place: renderable(input.session.place),
    handoverFrom: renderable(input.session.handoverFrom),
    handoverTo: renderable(input.session.handoverTo),
  }
  const lines: Line[] = input.lines.map((line) => ({
    ...line,
    code: renderable(line.code),
    name: renderable(line.name),
  }))
  const settings: Settings = { ...input.settings, company: renderable(input.settings.company) }

  const doc = await createPdfDoc()

  const M = 15
  const pageW = doc.internal.pageSize.getWidth()
  let y = M + 4

  doc.setFont(FONT_FAMILY, 'bold').setFontSize(18)
  doc.text('Předávací protokol', M, y)
  y += 7
  doc.setFont(FONT_FAMILY, 'normal').setFontSize(11).setTextColor(90)
  doc.text('Inventura zboží', M, y)
  doc.setTextColor(0)

  if (settings.company) {
    doc.setFont(FONT_FAMILY, 'bold').setFontSize(12)
    doc.text(settings.company, pageW - M, M + 4, { align: 'right' })
    doc.setFont(FONT_FAMILY, 'normal')
  }
  y += 8

  const totalPieces = lines.reduce((sum, l) => sum + l.qty, 0)

  autoTable(doc, {
    startY: y,
    theme: 'plain',
    styles: { font: FONT_FAMILY, fontSize: 10, cellPadding: { top: 0.8, bottom: 0.8, left: 0, right: 4 } },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 38, textColor: 90 } },
    body: [
      ['Inventura', session.name],
      ['Místo / sklad', session.place || '—'],
      ['Zahájeno', fmtDateTime(session.startedAt)],
      ['Ukončeno', session.closedAt ? fmtDateTime(session.closedAt) : 'neukončeno'],
      ['Vytištěno', fmtDateTime(Date.now())],
    ],
  })
  y = (doc as any).lastAutoTable.finalY + 8

  autoTable(doc, {
    startY: y,
    // "Kód zboží", not "Čárový kód": the column also carries internal codes read from
    // a QR, and those are not bar codes. The word has to fit every row under it.
    head: [['#', 'Kód zboží', 'Název zboží', 'Počet']],
    // Unlabelled goods carry a synthetic internal id. Printing it on a document
    // someone signs would read as a real barcode and send them hunting for it.
    body: lines.map((l, i) => [
      String(i + 1),
      l.noBarcode ? 'bez kódu' : l.code,
      l.name,
      fmtNum(l.qty),
    ]),
    foot: [['', '', 'Celkem kusů', fmtNum(totalPieces)]],
    styles: { font: FONT_FAMILY, fontSize: 10, cellPadding: 2 },
    headStyles: { font: FONT_FAMILY, fontStyle: 'bold', fillColor: [15, 23, 42], textColor: 255 },
    footStyles: { font: FONT_FAMILY, fontStyle: 'bold', fillColor: [241, 245, 249], textColor: 0 },
    columnStyles: {
      0: { cellWidth: 12, halign: 'right' },
      1: { cellWidth: 40 },
      3: { cellWidth: 22, halign: 'right' },
    },
    margin: { left: M, right: M },
  })
  y = (doc as any).lastAutoTable.finalY + 8

  doc.setFontSize(10)
  doc.text(
    `Počet položek (druhů zboží): ${fmtNum(lines.length)}          Celkem kusů: ${fmtNum(totalPieces)}`,
    M,
    y,
  )
  y += 16

  // Keep the signature block whole — a lone pair of lines on a fresh page looks
  // like a mistake, and a protocol signed on a detached page is worth arguing about.
  const SIGN_BLOCK_H = 40
  if (y + SIGN_BLOCK_H > doc.internal.pageSize.getHeight() - M) {
    doc.addPage()
    y = M + 10
  }

  const colW = (pageW - M * 2 - 10) / 2
  const signers: Array<[string, string]> = [
    ['Předávající', session.handoverFrom],
    ['Přebírající', session.handoverTo],
  ]
  signers.forEach(([role, name], i) => {
    const x = M + i * (colW + 10)
    doc.setDrawColor(120)
    doc.line(x, y, x + colW, y)
    doc.setFontSize(9).setTextColor(90)
    doc.text(role, x, y + 5)
    doc.setTextColor(0).setFontSize(11)
    if (name) doc.text(name, x, y - 2)
    doc.setFontSize(9).setTextColor(120)
    doc.text('jméno a podpis', x, y + 10)
    doc.setTextColor(0)
  })

  return doc.output('blob')
}

/** Filenames end in .pdf on purpose: iOS types shared files by extension, not MIME. */
export function protocolFileName(session: Session): string {
  const stamp = new Date(session.closedAt ?? session.startedAt)
    .toISOString()
    .slice(0, 10)
  const slug =
    session.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'inventura'
  return `protokol-${slug}-${stamp}.pdf`
}

// Re-exported so callers of this module keep working; the implementation lives in
// its own file so non-PDF callers don't drag jsPDF into the startup bundle.
export { downloadBlob } from './download'
