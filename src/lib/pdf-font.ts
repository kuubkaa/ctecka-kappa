import { jsPDF } from 'jspdf'
import charset from './charset.json'

/**
 * The Czech-capable font, and the guard that stops jsPDF quietly eating text.
 *
 * Shared by every PDF the app makes. It lives apart from pdf.ts so a second document
 * cannot accidentally grow its own font setup: the failure mode here is silent, so
 * "the labels PDF forgot to register the bold face" would ship looking fine and come
 * back as a complaint about mangled diacritics months later.
 */

export const FONT_FAMILY = 'Roboto'

/**
 * Both faces are required wherever text is bold. With no bold face registered jsPDF
 * falls back to Helvetica and corrupts just the bold runs, logging a warning rather
 * than throwing. See the diacritics assertion in e2e/protocol.spec.ts.
 */
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

/** An A4 document in millimetres, with both font faces already registered. */
export async function createPdfDoc(): Promise<jsPDF> {
  const fonts = await loadFonts()
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  for (const face of FACES) {
    doc.addFileToVFS(face.file, fonts[face.file]!)
    doc.addFont(face.file, FONT_FAMILY, face.style)
  }
  doc.setFont(FONT_FAMILY, 'normal')
  return doc
}

/** Shortens to fit `maxW` mm, with an ellipsis. Assumes the caller set the font size. */
export function fitText(doc: jsPDF, text: string, maxW: number): string {
  if (doc.getTextWidth(text) <= maxW) return text
  let out = text
  while (out.length > 1 && doc.getTextWidth(`${out}…`) > maxW) out = out.slice(0, -1)
  return `${out}…`
}
