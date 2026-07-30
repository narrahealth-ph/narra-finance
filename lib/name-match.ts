/**
 * Normalize a company/client name for fuzzy matching:
 * lowercase, strip punctuation, collapse whitespace.
 */
function normalize(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[.,\/#!$%^&*;:{}=_`~()'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Returns true if two client names refer to the same entity.
 * Handles:
 *   - Case differences            "OFII" === "ofii"
 *   - Punctuation differences     "Acme Inc." === "Acme Inc"
 *   - One name is a subset        "Rayomar" matches "Rayomar Group"
 *   - Word-order-independent      all words of shorter appear in longer
 */
export function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false

  const na = normalize(a)
  const nb = normalize(b)

  if (na === nb) return true

  // Split into meaningful words (length > 1 to skip stray letters)
  const wordsA = na.split(' ').filter(w => w.length > 1)
  const wordsB = nb.split(' ').filter(w => w.length > 1)

  if (wordsA.length === 0 || wordsB.length === 0) return false

  const [shorter, longer] =
    wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA]

  // All words of the shorter name must appear in the longer name
  return shorter.every(w => longer.includes(w))
}
