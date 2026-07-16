/**
 * Czech has three plural forms where English has two: 1 kus, 2 kusy, 5 kusů.
 * "1 položek" reads as broken software to a native speaker, and this app is used
 * exclusively by Czech speakers.
 *
 * Intl.PluralRules knows the rules; hand-rolled n === 1 checks do not.
 */
const rules = new Intl.PluralRules('cs')

interface Forms {
  /** 1 */
  one: string
  /** 2–4 */
  few: string
  /** 0, 5+ */
  other: string
}

function form(n: number, forms: Forms): string {
  const category = rules.select(n)
  if (category === 'one') return forms.one
  if (category === 'few') return forms.few
  return forms.other
}

const PIECE: Forms = { one: 'kus', few: 'kusy', other: 'kusů' }
const ENTRY: Forms = { one: 'položka', few: 'položky', other: 'položek' }

/** Just the noun, correctly declined — for when the number is displayed separately. */
export const pieceWord = (n: number) => form(n, PIECE)

export const pieces = (n: number) => `${n.toLocaleString('cs-CZ')} ${form(n, PIECE)}`
export const entries = (n: number) => `${n.toLocaleString('cs-CZ')} ${form(n, ENTRY)}`
