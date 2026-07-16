/**
 * Minimal EAN-13 encoder, so the scanner test can decode a barcode this repo
 * generated rather than a fixture image someone has to trust.
 *
 * Encoding runs in Node; the test hands the resulting module pattern to the page,
 * which only has to paint black and white bars.
 */

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']

/** Which of the first six digits use G instead of L — this is what encodes digit 1. */
const PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
]

function digits(value: string): number[] {
  return [...value].map((c) => {
    const d = Number(c)
    if (!/[0-9]/.test(c) || Number.isNaN(d)) throw new Error(`Not a digit: ${c}`)
    return d
  })
}

/** Appends the check digit to 12 digits, yielding a scannable EAN-13. */
export function withCheckDigit(twelve: string): string {
  if (twelve.length !== 12) throw new Error(`Expected 12 digits, got ${twelve.length}`)
  const ds = digits(twelve)
  const sum = ds.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0)
  return twelve + String((10 - (sum % 10)) % 10)
}

/** Returns the 95-module black/white pattern as a string of '0' and '1'. */
export function encodeEan13(code13: string): string {
  if (code13.length !== 13) throw new Error(`Expected 13 digits, got ${code13.length}`)
  if (withCheckDigit(code13.slice(0, 12)) !== code13) throw new Error(`Bad check digit: ${code13}`)

  const ds = digits(code13)
  const parity = PARITY[ds[0]!]!

  let out = '101' // start guard
  for (let i = 1; i <= 6; i++) {
    out += (parity[i - 1] === 'L' ? L : G)[ds[i]!]!
  }
  out += '01010' // centre guard
  for (let i = 7; i <= 12; i++) {
    out += R[ds[i]!]!
  }
  out += '101' // end guard

  if (out.length !== 95) throw new Error(`Bad pattern length ${out.length}`)
  return out
}
