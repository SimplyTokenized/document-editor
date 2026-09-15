/**
 * Heading numbering — "1.", "1.1", "1.1.1" — computed from each heading's level and whether
 * it is numbered, the way Word's multilevel heading numbering behaves:
 *
 *   - An unnumbered heading ("Document Control", "Schedule A") is skipped entirely: it takes
 *     no number and resets nothing, so section 2 still follows section 1 across it.
 *   - The shallowest NUMBERED level in the document is the top level. A document that
 *     numbers its H1s reads "1." / "1.1"; one that keeps H1 as the title and numbers from H2
 *     reads "1." / "1.1" one level down.
 *   - A heading with no explicit choice keeps the editor's original scheme (H1 the title,
 *     H2/H3 numbered), so templates saved before numbering was switchable look unchanged.
 *
 * Shared by the editor (the HeadingNumbering decorations) and both exports, so the number an
 * author sees is the number in the .docx and the PDF. Pure — no editor, no DOM beyond the
 * element walk in `headingNumbersFor`.
 */

/** Where a heading's numbering choice is stored: `"true"`, `"false"`, or absent (default). */
export const HEADING_NUMBERED_ATTR = 'data-numbered'

/** @returns {boolean | null} the stored choice; null when the heading makes none */
export const parseHeadingNumbered = (value) =>
  value === 'true' ? true : value === 'false' ? false : null

/** Whether a heading is numbered, falling back to the original scheme when it has no choice. */
export const isHeadingNumbered = (level, numbered) =>
  numbered == null ? level >= 2 : Boolean(numbered)

/**
 * @param {{ level: number, numbered?: boolean | null }[]} headings in document order
 * @returns {(string | null)[]} each heading's label ("1.", "2.1"), null when unnumbered
 */
export const computeHeadingNumbers = (headings) => {
  const numbered = headings.map((h) => isHeadingNumbered(h.level, h.numbered))
  const numberedLevels = headings.filter((_, i) => numbered[i]).map((h) => h.level)
  if (!numberedLevels.length) return headings.map(() => null)

  const top = Math.min(...numberedLevels)
  const counters = new Array(7).fill(0) // indexed by heading level
  return headings.map((heading, i) => {
    if (!numbered[i]) return null
    counters[heading.level] += 1
    for (let level = heading.level + 1; level < counters.length; level += 1) counters[level] = 0
    const parts = counters.slice(top, heading.level + 1)
    // A top-level section reads "1.", a sub-section "1.1" — Word's legal outline.
    return parts.length === 1 ? `${parts[0]}.` : parts.join('.')
  })
}

/**
 * Labels for every h1–h3 under `root`, in document order — the exports' view of the same
 * numbering the editor draws.
 * @param {ParentNode} root
 * @returns {Map<Element, string>} numbered headings only
 */
export const headingNumbersFor = (root) => {
  const elements = Array.from(root.querySelectorAll('h1, h2, h3'))
  const labels = computeHeadingNumbers(
    elements.map((el) => ({
      level: Number(el.tagName.slice(1)),
      numbered: parseHeadingNumbered(el.getAttribute(HEADING_NUMBERED_ATTR)),
    })),
  )
  const byElement = new Map()
  elements.forEach((el, i) => {
    if (labels[i]) byElement.set(el, labels[i])
  })
  return byElement
}

// Text style a heading's number borrows from its line, and the CSS custom property that
// carries each value to the number's ::before rule.
const NUMBER_STYLE_KEYS = [
  ['fontFamily', '--heading-number-font-family'],
  ['fontSize', '--heading-number-font-size'],
  ['color', '--heading-number-color'],
]

/**
 * Keep only the font / size / colour `next` shares with `common` — fold this over every run
 * of a heading, starting from null. As in Word, the number takes the line's formatting when
 * the WHOLE line has it; a line in mixed fonts leaves the number in the heading's own.
 */
export const mergeCommonTextStyle = (common, next) => {
  const style = Object.fromEntries(NUMBER_STYLE_KEYS.map(([key]) => [key, next[key] || null]))
  if (!common) return style
  return Object.fromEntries(
    NUMBER_STYLE_KEYS.map(([key]) => [key, common[key] === style[key] ? common[key] : null]),
  )
}

/** The custom properties that hand a heading's shared text style to its number. */
export const headingNumberStyleCss = (style) =>
  NUMBER_STYLE_KEYS.filter(([key]) => style[key])
    .map(([key, property]) => `${property}: ${String(style[key]).replace(/[;{}]/g, '')}`)
    .join('; ')

/**
 * The HTML counterpart of the editor's mark walk: the style every non-blank text node in
 * `heading` inherits from inline styles inside it.
 * @param {Element} heading
 */
export const commonHeadingTextStyle = (heading) => {
  const walker = heading.ownerDocument.createTreeWalker(heading, 4) // NodeFilter.SHOW_TEXT
  let common = null
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!text.textContent.trim()) continue
    const inherited = {}
    NUMBER_STYLE_KEYS.forEach(([key]) => {
      for (let el = text.parentElement; el && el !== heading; el = el.parentElement) {
        if (el.style?.[key]) {
          inherited[key] = el.style[key]
          return
        }
      }
    })
    common = mergeCommonTextStyle(common, inherited)
  }
  return common || {}
}
