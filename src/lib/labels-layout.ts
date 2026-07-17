/**
 * The label sheet's grid, in millimetres.
 *
 * Apart from labels.ts so a screen can say "18 stran A4" without importing jsPDF and
 * the embedded font — a third of the app's code — just to do the arithmetic.
 *
 * Four across and seven down gives a 47.5 x 39.6 mm label: big enough for a QR a phone
 * reads without a fight, small enough that a few hundred SKUs aren't a ream of paper.
 */
export const PAGE = { w: 210, h: 297 } // A4
export const MARGIN = 10
export const COLS = 4
export const ROWS = 7

export const LABEL_W = (PAGE.w - MARGIN * 2) / COLS
export const LABEL_H = (PAGE.h - MARGIN * 2) / ROWS
export const PER_PAGE = COLS * ROWS

export const labelPageCount = (items: number) => Math.ceil(items / PER_PAGE)
