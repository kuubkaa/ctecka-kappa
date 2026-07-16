import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import charset from './charset.json'
import type { Line, Session, Settings } from '../db'

const FONT_FAMILY = 'Roboto'
const FACES = [
  { file: 'Roboto-cs-regular.ttf', style: 'normal' },
  { file: 'Roboto-cs-bold.ttf', style: 'bold' },
] as const

/** Every character the embedded font can draw — generated alongside the fonts. */
const RENDERABLE = new Set([...charset.chars])
const REPLACEMENT = '?'

/**
 * Screens text against the font before it reaches jsPDF.
 *
 * jsPDF's response to a character its font lacks is silent data loss, and it takes
 * two different forms (both measured against our own subset):
 *   "Müsli tyčinka ořechová" -> "M"              — truncates the rest of the string
 *   "Slovenská ľalia ôsma"   -> "Slovenská alia" — drops the character, keeps going
 * On a document someone signs, a product name quietly becoming "M" is far worse than
 * one showing a "?" — the "?" is visible, so it gets noticed and fixed.
 *
 * The font covers Latin-1 + Latin Extended-A, so in practice this only fires for
 * Cyrillic, Greek, CJK or emoji.
 */
export function renderable(text: string): string {
  let out = ''
  for (const ch of text) out += RENDERABLE.has(ch) ? ch : REPLACEMENT
  return out
}

/**
 * jsPDF's built-in fonts are cp1252, not Unicode. They render á é í ó ú ý ž š fine
 * but silently mangle ě č ř ů ť ď ň — "Předávací" comes out "PYedávací" and ě/č/ď
 * vanish entirely. So we embed a Czech-capable font.
 *
 * Both faces are required. autoTable renders header rows bold; with no bold face
 * registered jsPDF falls back to Helvetica and corrupts just the header, logging a
 * warning rather than throwing. See the diacritics assertion in e2e/protocol.spec.ts.
 */
let fontsPromise: Promise<Record<string, string>> | null = null

function toBinaryString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let out = ''
  const CHUNK = 0x8000 // Spreading the whole array blows the call stack on big fonts.
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return out
}

async function loadFonts(): Promise<Record<string, string>> {
  fontsPromise ??= (async () => {
    const entries = await Promise.all(
      FACES.map(async (face) => {
        const res = await fetch(`${import.meta.env.BASE_URL}fonts/${face.file}`)
        if (!res.ok) throw new Error(`Nepodařilo se načíst font ${face.file} (${res.status})`)
        return [face.file, toBinaryString(await res.arrayBuffer())] as const
      }),
    )
    return Object.fromEntries(entries)
  })()
  return fontsPromise
}

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

  const fonts = await loadFonts()
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  for (const face of FACES) {
    doc.addFileToVFS(face.file, fonts[face.file]!)
    doc.addFont(face.file, FONT_FAMILY, face.style)
  }
  doc.setFont(FONT_FAMILY, 'normal')

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
    head: [['#', 'Čárový kód', 'Název zboží', 'Počet']],
    body: lines.map((l, i) => [String(i + 1), l.code, l.name, fmtNum(l.qty)]),
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

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking immediately can cancel the download on some mobile browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
