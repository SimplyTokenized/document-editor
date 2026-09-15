/**
 * SVG helpers for the vector illustration block — the one place the stored SVG is made
 * safe and regular, shared by the node's parseHTML, the workspace's save, the .docx import
 * and the .docx export.
 *
 * SECURITY. Inline SVG in the document HTML is an XSS vector (scripts, event handlers,
 * foreignObject, javascript: links, external image/use references), and the backend
 * stores and re-serves the HTML without sanitising it. Every string that becomes the
 * node's `svg` attribute passes through `sanitizeSvg` first — stored HTML, pasted markup,
 * SVG-Edit's output, pictures from a .docx — so the attribute is always trusted and the
 * read-only views and the PDF renderers can render it as is. DOMPurify's SVG profile does
 * the heavy lifting; the hooks below close its two gaps (external http(s) references,
 * which it allows, and url() in style, which it does not inspect). SVG-Edit's own
 * `sanitizeSvg` is a compatibility filter for its canvas, not a security boundary.
 *
 * SHAPE. The stored SVG is standalone W3C SVG: an `xmlns`, a `viewBox`, `width`/`height`
 * in px, no editor artefacts — SVG-Edit writes an `id="svgcontent"`, `x`/`y`/`overflow` on
 * the root, its own namespace and a comment, none of which belong in a document.
 */
import DOMPurify from 'dompurify'

export const SVG_NS = 'http://www.w3.org/2000/svg'
export const XLINK_NS = 'http://www.w3.org/1999/xlink'
/** Marks the block's wrapper in stored HTML: `<figure data-vector-illustration="1">`. */
export const VECTOR_ATTR = 'data-vector-illustration'
export const DEFAULT_ARTBOARD = { width: 640, height: 360 }

const SAFE_HREF = /^(#[\w:.-]+|data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+)$/i
const UNSAFE_STYLE = /url\(\s*(?!['"]?#)|expression\s*\(|@import|behavior\s*:/i
// Elements DOMPurify's SVG profile allows that a document illustration never needs.
const FORBID_TAGS = ['style', 'foreignObject', 'use', 'script', 'animate', 'animateTransform', 'animateMotion', 'set', 'a']

let purifier = null
const getPurifier = () => {
  if (purifier) return purifier
  purifier = DOMPurify(window)
  purifier.addHook('afterSanitizeAttributes', (node) => {
    // DOMPurify permits http(s) references; a document must not fetch anything from the
    // network when it is opened (tracking, IP leaks, tainted rasterisation).
    for (const name of ['href', 'xlink:href']) {
      const value = node.getAttribute?.(name)
      if (value != null && !SAFE_HREF.test(value.trim())) node.removeAttribute(name)
    }
    const style = node.getAttribute?.('style')
    if (style && UNSAFE_STYLE.test(style)) node.removeAttribute('style')
  })
  return purifier
}

const parseSvgDocument = (source) =>
  new DOMParser().parseFromString(String(source), 'image/svg+xml')

/** `image/svg+xml` parsing yields a <parsererror> document on malformed input. */
const isParseError = (doc) => doc.getElementsByTagName('parsererror').length > 0

const numberAttr = (el, name) => {
  const raw = el.getAttribute(name)
  if (raw == null) return null
  const value = parseFloat(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Width/height of an SVG root in px: its `width`/`height` when unitless or px, else the
 * viewBox, else the default artboard.
 */
export const svgElementSize = (root) => {
  let width = numberAttr(root, 'width')
  let height = numberAttr(root, 'height')
  const viewBox = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
  const boxOk = viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0
  if (!width || !height) {
    if (boxOk) {
      width = width || viewBox[2]
      height = height || viewBox[3]
    } else {
      width = width || DEFAULT_ARTBOARD.width
      height = height || DEFAULT_ARTBOARD.height
    }
  }
  return { width: Math.round(width), height: Math.round(height) }
}

/** @param {string} source @returns {{ width: number, height: number }} */
export const svgSize = (source) => {
  const doc = parseSvgDocument(source)
  if (isParseError(doc) || doc.documentElement?.localName !== 'svg') return { ...DEFAULT_ARTBOARD }
  return svgElementSize(doc.documentElement)
}

/**
 * Make an SVG root regular: the document's own namespace declarations, a viewBox, px
 * width/height, and none of SVG-Edit's canvas attributes. Mutates and returns the root.
 */
const normalizeRoot = (root) => {
  const { width, height } = svgElementSize(root)
  ;['id', 'x', 'y', 'overflow', 'class', 'style'].forEach((name) => root.removeAttribute(name))
  Array.from(root.attributes).forEach((attr) => {
    if (attr.name.startsWith('xmlns:') && attr.name !== 'xmlns:xlink') root.removeAttribute(attr.name)
    else if (attr.name.startsWith('data-')) root.removeAttribute(attr.name)
  })
  root.setAttribute('xmlns', SVG_NS)
  if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${width} ${height}`)
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  // SVG-Edit's `se:*` attributes (nonce, connector) and comments carry nothing a reader needs.
  const walker = root.ownerDocument.createTreeWalker(root, 1 | 128) // elements + comments
  const drop = []
  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === 8) drop.push(node)
    else if (node !== root) {
      Array.from(node.attributes).forEach((attr) => {
        if (attr.name.includes(':') && !attr.name.startsWith('xlink:') && !attr.name.startsWith('xml:')) {
          node.removeAttribute(attr.name)
        }
      })
    }
  }
  drop.forEach((node) => node.parentNode?.removeChild(node))
  return root
}

/**
 * Sanitise and normalise SVG source (a string, or an element already in the DOM).
 * @returns {{ svg: string, width: number, height: number } | null} null when nothing
 *   usable survives — the caller then rejects the node rather than storing an empty one.
 */
export const sanitizeSvg = (source) => {
  const text = typeof source === 'string' ? source : source?.outerHTML
  if (!text || !/<svg[\s>]/i.test(text)) return null
  // Parsed as HTML on purpose: the HTML parser folds SVG names to their proper case
  // (linearGradient, viewBox) and DOMPurify's allowlists are matched case-insensitively
  // that way; in its XML mode camelCase elements fail the lowercase allowlist and vanish.
  const clean = getPurifier().sanitize(text, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS,
    RETURN_DOM: true,
  })
  const root = clean?.localName === 'svg' ? clean : clean?.querySelector?.('svg')
  if (!root) return null
  // Serialise as XML: Word's SVG part must be well-formed, and an HTML serialisation of an
  // SVG-namespace element is not guaranteed to be.
  const doc = parseSvgDocument(new XMLSerializer().serializeToString(root))
  if (isParseError(doc) || doc.documentElement?.localName !== 'svg') return null
  const normalized = normalizeRoot(doc.documentElement)
  const { width, height } = svgElementSize(normalized)
  return { svg: new XMLSerializer().serializeToString(normalized), width, height }
}

/** A blank artboard the editor opens for a new illustration. */
export const emptyArtboard = (width = DEFAULT_ARTBOARD.width, height = DEFAULT_ARTBOARD.height) =>
  `<svg xmlns="${SVG_NS}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><g class="layer"><title>Layer 1</title></g></svg>`

/**
 * The stored SVG as a live element for the page, sized for display. `null` if the string
 * does not parse — the caller shows a placeholder instead of nothing.
 */
export const svgToElement = (source, { width, height } = {}) => {
  const doc = parseSvgDocument(source || '')
  if (isParseError(doc) || doc.documentElement?.localName !== 'svg') return null
  const el = document.importNode(doc.documentElement, true)
  if (width) el.setAttribute('width', String(width))
  if (height) el.setAttribute('height', String(height))
  return el
}

/** The root's viewBox as numbers, or null. */
export const viewBoxOf = (source) => {
  const doc = parseSvgDocument(source)
  if (isParseError(doc)) return null
  const parts = (doc.documentElement.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || !parts.every(Number.isFinite) || parts[2] <= 0 || parts[3] <= 0) return null
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
}

/**
 * The SVG as SVG-Edit's canvas wants it: an artboard of `width`×`height` px whose user
 * space starts at 0,0. A stored illustration is cropped to its drawing (viewBox offset),
 * but the shapes keep their absolute coordinates, so an artboard large enough to contain
 * the viewBox shows them exactly where they were drawn.
 */
export const svgForCanvas = (source, width, height) => {
  const doc = parseSvgDocument(source)
  if (isParseError(doc)) return source
  const root = doc.documentElement
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  root.setAttribute('viewBox', `0 0 ${width} ${height}`)
  return new XMLSerializer().serializeToString(root)
}

/**
 * Crop the SVG to `box` (user-space units): the viewBox becomes the box and the px size
 * its dimensions, so the block in the document covers exactly the drawing.
 */
export const cropSvgTo = (source, box) => {
  const doc = parseSvgDocument(source)
  if (isParseError(doc)) return null
  const root = doc.documentElement
  const width = Math.max(1, Math.round(box.width))
  const height = Math.max(1, Math.round(box.height))
  const r = (n) => Math.round(n * 100) / 100
  root.setAttribute('viewBox', `${r(box.x)} ${r(box.y)} ${width} ${height}`)
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  return { svg: new XMLSerializer().serializeToString(root), width, height }
}

/**
 * Bounding box of everything drawn in a live SVG element, stroke included; null when it
 * holds nothing visible. Measured with getBBox on each shape, which needs a rendered DOM.
 */
export const drawnBox = (svgEl, padding = 2) => {
  const shapes = svgEl.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon, text, image, use')
  let box = null
  shapes.forEach((el) => {
    if (el.closest('defs')) return
    let b
    try {
      b = el.getBBox()
    } catch {
      return
    }
    if (!(b.width > 0 || b.height > 0)) return
    const stroke = parseFloat(getComputedStyle(el).strokeWidth) || 0
    const half = getComputedStyle(el).stroke !== 'none' ? stroke / 2 : 0
    // A transform on the shape (rotation, move) is not in getBBox; map its corners.
    const m = el.getCTM && svgEl.getCTM ? svgEl.getCTM().inverse().multiply(el.getCTM()) : null
    const corners = [
      [b.x - half, b.y - half],
      [b.x + b.width + half, b.y - half],
      [b.x - half, b.y + b.height + half],
      [b.x + b.width + half, b.y + b.height + half],
    ].map(([x, y]) => (m ? [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f] : [x, y]))
    const xs = corners.map((c) => c[0])
    const ys = corners.map((c) => c[1])
    const next = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
    box = box
      ? { x1: Math.min(box.x1, next.x1), y1: Math.min(box.y1, next.y1), x2: Math.max(box.x2, next.x2), y2: Math.max(box.y2, next.y2) }
      : next
  })
  if (!box) return null
  return {
    x: box.x1 - padding,
    y: box.y1 - padding,
    width: box.x2 - box.x1 + padding * 2,
    height: box.y2 - box.y1 + padding * 2,
  }
}

/**
 * Rasterise the (sanitised) SVG to PNG bytes for renderers that cannot draw vectors —
 * the fallback Word requires beside an SVG picture. Sanitised SVG has no foreignObject
 * and no external references, so the canvas is never tainted.
 * @returns {Promise<Uint8Array>}
 */
export const rasterizeSvg = async (source, { scale = 3 } = {}) => {
  const { width, height } = svgSize(source)
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = 'sync'
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = () => reject(new Error('SVG could not be rasterised.'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const png = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png'),
    )
    return new Uint8Array(await png.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}
