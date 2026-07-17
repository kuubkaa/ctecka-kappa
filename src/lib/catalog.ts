/**
 * Loading the product catalog from a Google Sheet.
 *
 * The app has no server, so the phone fetches the sheet itself. That works because
 * Google's gviz CSV endpoint answers cross-origin requests: measured against a
 * shared sheet from https://kuubkaa.github.io it returns 200, `text/csv`, and
 * `access-control-allow-origin` echoing the origin. No proxy, no API key, no OAuth.
 *
 * One-way on purpose. Barcodes and names come in; nothing about a stocktake ever
 * goes out. That is what makes a cloud sheet compatible with the decision not to
 * sync — a signed protocol carries people's names, a product list does not.
 *
 * Needs signal, which the warehouse has none of. That is fine: you load the catalog
 * before you go, and counting stays entirely offline afterwards.
 */

import { codeKey } from '../db'

/** A row the user is prepared to see counted: a real barcode and what it is called. */
export interface CatalogRow {
  code: string
  name: string
}

export interface CatalogPreview {
  rows: CatalogRow[]
  /** Rows that had a code or a name but not both — reported, never guessed at. */
  skipped: number
}

export class CatalogError extends Error {}

/**
 * Sheet ids are 40-odd chars. The `{20,}` floor matters: a "publish to web" URL is
 * /spreadsheets/d/e/2PACX-..., and a lazier pattern happily captures the "e" and
 * builds a request for a sheet that does not exist.
 */
const SHEET_ID = /\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/
const PUBLISHED_TO_WEB = /\/spreadsheets\/d\/e\//
const GID = /[#?&]gid=(\d+)/

const SHARE_HINT =
  'Otevři tabulku, dej Sdílet → Kopírovat odkaz a vlož ten.'

/**
 * Turns whatever the user pasted into the CSV endpoint.
 *
 * The gid is taken from the pasted URL rather than typed, and that is deliberate:
 * Google silently ignores a gid (or a sheet name) it does not recognise and serves
 * the *first* tab with HTTP 200 and a straight face. A typo would therefore import
 * a different tab's data and report success. A gid copied out of a real URL is a
 * real gid — and the preview dialog is what catches the rest.
 */
export function csvUrlFor(sheetUrl: string): string {
  const url = sheetUrl.trim()
  if (!url) throw new CatalogError('Vlož odkaz na tabulku.')
  if (PUBLISHED_TO_WEB.test(url)) {
    throw new CatalogError(`Tohle je odkaz z „Publikovat na webu“. ${SHARE_HINT}`)
  }
  const id = SHEET_ID.exec(url)?.[1]
  if (!id) throw new CatalogError(`Tohle není odkaz na Google tabulku. ${SHARE_HINT}`)
  const gid = GID.exec(url)?.[1]
  // Built by hand rather than with URLSearchParams: the endpoint was verified with a
  // literal `tqx=out:csv`, and percent-encoding the colon is an untested variation.
  // Both values are regex-constrained to safe characters.
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ''}`
}

const NOT_SHARED =
  'Tabulka není sdílená, nebo odkaz nesedí. V tabulce dej Sdílet → Obecný přístup → Kdokoli s odkazem, role Čtenář.'

export async function fetchCatalog(sheetUrl: string): Promise<CatalogPreview> {
  const url = csvUrlFor(sheetUrl)
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    // Offline, or the browser blocked it. Either way the user cannot act on the
    // difference, and "no signal" is the overwhelmingly likely cause in this app.
    throw new CatalogError('Tabulku se nepodařilo stáhnout. Zkontroluj připojení k internetu.')
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new CatalogError(NOT_SHARED)
  }
  if (!res.ok) throw new CatalogError(`Google tabulku nevrátil (chyba ${res.status}).`)

  // A sheet that is not shared can also come back as a *login page* with HTTP 200,
  // which would parse into nonsense products rather than an error. The content type
  // is what separates "here is your data" from "here is a sign-in form".
  if (!/^text\/csv/i.test(res.headers.get('content-type') ?? '')) {
    throw new CatalogError(NOT_SHARED)
  }
  return parseCatalog(await res.text())
}

/** RFC 4180: quoted fields may contain commas, newlines and doubled quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  // Strip the BOM; left in, it becomes part of the first cell and every code misses.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0

  for (; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') (field += '"'), i++
      else quoted = false
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') (row.push(field), (field = ''))
    else if (c === '\n') (row.push(field), rows.push(row), (row = []), (field = ''))
    else if (c !== '\r') field += c
  }
  if (field || row.length) (row.push(field), rows.push(row))
  return rows
}

/**
 * Header cells the user is likely to have typed above the codes.
 *
 * The trailing `[\s._/-]*\w*` is not decoration. A header only falls out on its own if
 * it fails PLAUSIBLE_CODE, and "EAN-13" or "Kod_zbozi" pass it — no spaces, no
 * diacritics — so without this they arrive as a product called whatever B1 says.
 * "EAN-13" is the barcode standard's actual name; expecting the user to avoid it is
 * expecting them to know our regex.
 */
const HEADER_WORD = /^(k[oó]d|[čc][áa]rov[ýy]\s*k[oó]d|ean|code|barcode)[\s._/-]*\w*$/i

/**
 * Barcodes are digits, but the scanner also reads CODE-39/128 and QR, which carry
 * letters and punctuation. Kept broad on purpose — a code this rejects is a code the
 * app could never match anyway. Spaces are excluded, which is what makes a header
 * like "Čárový kód" fall out on its own.
 */
const PLAUSIBLE_CODE = /^[0-9A-Za-z._/-]{1,48}$/

/**
 * Google rendering a barcode as 8,59400E+12 — the cell was a number, not text, and
 * the digits are already gone. Detected rather than skipped: silently dropping these
 * would leave the user re-typing names forever with no idea why.
 */
const SCIENTIFIC = /^\d(?:[.,]\d+)?e\+?\d+$/i

export function parseCatalog(csv: string): CatalogPreview {
  const grid = parseCsv(csv)
  const first = grid[0]?.[0]?.trim() ?? ''
  // Drop a header row without asking the user whether they have one: a header cell is
  // by definition not a plausible code.
  const start = grid.length && (HEADER_WORD.test(first) || !PLAUSIBLE_CODE.test(first)) ? 1 : 0

  const rows: CatalogRow[] = []
  const at = new Map<string, number>()
  let skipped = 0
  let scientific = false

  for (let i = start; i < grid.length; i++) {
    const cells = grid[i] ?? []
    const code = (cells[0] ?? '').trim()
    const name = (cells[1] ?? '').trim()
    if (!code && !name) continue // blank spacer row — not the user's mistake
    if (SCIENTIFIC.test(code)) {
      scientific = true
      continue
    }
    if (!code || !name || !PLAUSIBLE_CODE.test(code)) {
      skipped++
      continue
    }
    // Keyed case-insensitively, like every lookup in db.ts: "311283-194-M" and
    // "311283-194-m" are one product, and letting both through would create the pair
    // of rows that makes a case-insensitive lookup ambiguous.
    const seen = at.get(codeKey(code))
    // The same barcode twice in one sheet: the lower row wins, matching how a person
    // reads a list top to bottom and how bulkPut would resolve it anyway.
    if (seen !== undefined) rows[seen] = { code, name }
    else (at.set(codeKey(code), rows.length), rows.push({ code, name }))
  }

  // Refuse the whole sheet rather than import the intact half. Scientific notation
  // comes from the column's formatting, so the rest of the column is a coin toss —
  // and a wrong barcode counts real goods under the wrong name, on a signed protocol.
  if (scientific) {
    throw new CatalogError(
      'Google udělal z kódů čísla (8,59400E+12) a číslice se ztratily. Označ sloupec s kódy, dej Formát → Číslo → Prostý text, kódy přepiš a zkus to znovu.',
    )
  }
  if (!rows.length) {
    throw new CatalogError(
      'V tabulce jsem nenašel žádné zboží. První sloupec musí být čárový kód, druhý název.',
    )
  }
  return { rows, skipped }
}
