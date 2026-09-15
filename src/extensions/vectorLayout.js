/**
 * How a vector illustration sits in the text — shared by the node's renderHTML (stored
 * HTML), its React view (the editor) and the print stylesheet, so all three agree.
 *
 * `wrap`:
 *   - 'none'  — a block of its own; text above and below (aligned left/center/right).
 *   - 'left'  — floats at the left margin, text flows on its right.
 *   - 'right' — floats at the right margin, text flows on its left.
 *
 * Moving the illustration up or down the page is drag and drop of the block itself
 * (ProseMirror's draggable node); this only decides how the surrounding text treats it.
 */
export const VECTOR_WRAPS = ['none', 'left', 'right']

export const normalizeWrap = (value) => (VECTOR_WRAPS.includes(value) ? value : 'none')

const pixels = (value) => {
  const n = Number.parseInt(String(value ?? '').replace(/px$/i, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Inline style for the figure — a CSS string, as the stored HTML carries it. */
export const vectorPresentationStyle = ({ align, width, height, wrap }) => {
  const parts = ['max-width:100%']
  const w = pixels(width)
  const h = pixels(height)
  if (w) parts.push(`width:${w}px`, h ? `height:${h}px` : 'height:auto')
  else parts.push('width:fit-content', 'height:auto')

  const mode = normalizeWrap(wrap)
  if (mode === 'left') {
    parts.push('float:left', 'margin:0.25rem 1rem 0.5rem 0')
  } else if (mode === 'right') {
    parts.push('float:right', 'margin:0.25rem 0 0.5rem 1rem')
  } else {
    parts.push('display:block')
    if (align === 'center') parts.push('margin-left:auto', 'margin-right:auto')
    else if (align === 'right') parts.push('margin-left:auto', 'margin-right:0')
    else parts.push('margin-left:0', 'margin-right:auto')
  }
  return `${parts.join(';')};`
}

/** The wrap a stored figure declares, from its attribute or its inline float. */
export const parseWrapFromElement = (element) => {
  const declared = element.getAttribute('data-wrap')
  if (VECTOR_WRAPS.includes(declared)) return declared
  const float = element.style?.float || element.style?.cssFloat
  return float === 'left' || float === 'right' ? float : 'none'
}
