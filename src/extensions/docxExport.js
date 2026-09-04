/**
 * Export the editor's stored HTML to a real .docx file.
 *
 * Walks the parsed HTML and builds a genuine Word document with the `docx` library —
 * this is NOT an "HTML wrapped in a docx shell" trick, so the result opens cleanly in
 * Word with real paragraphs, headings, native (nestable) list numbering, tables, and
 * embedded images.
 *
 * Numbering: ordered lists use Word's own native multi-level "legal" numbering
 * (isLegalNumberingStyle), so Word itself renders and maintains "1.", "1.1.", "1.1.1."
 * as the user keeps editing in Word. Heading numbers (H2/H3), which the editor computes
 * live via CSS counters, don't have a simple native-Word equivalent, so they're
 * materialized here as literal leading text using the SAME counting scheme — the
 * exported numbers always match exactly what was shown in the editor.
 */
import {
  AlignmentType,
  BorderStyle,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  HighlightColor,
  ImageRun,
  InsertedTextRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { parseCommentPayload } from './changeCommentPayload.js'

/**
 * Per-export tracked-changes state (module-level, mirroring currentPage/cellMargins). When
 * `enabled`, tracked insertions/deletions become native Word revisions (w:ins / w:del) and
 * comment marks become real Word comments — so the redline is visible and editable in Word.
 * `revId`/`commentId` hand out unique ids; `comments` collects the comment definitions that
 * get attached to the Document at the end.
 */
let trackedCtx = { enabled: false, revId: 1, commentId: 1, comments: [] }

/** A stable-per-export author date. Word needs a Date on each revision. */
const REVISION_DATE = new Date(0)

const LEGAL_NUMBERING_REF = 'legal-ordered-list'
const LEGAL_NUMBERING_LEVELS = 6

// Default page geometry (twips) when a document wasn't imported from a source .docx.
const DEFAULT_PAGE = {
  size: { width: 11906, height: 16838 }, // A4
  margins: { top: 1134, right: 1134, bottom: 1134, left: 1134 }, // 2cm
}

// Active page geometry + derived printable width, set per export from the source document's
// own pgSz/pgMar (so margins round-trip exactly) or DEFAULT_PAGE when authored from scratch.
let currentPage = DEFAULT_PAGE
let CONTENT_WIDTH_TWIPS = DEFAULT_PAGE.size.width - DEFAULT_PAGE.margins.left * 2

const DEFAULT_CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' }
const DEFAULT_CELL_BORDERS = {
  top: DEFAULT_CELL_BORDER,
  bottom: DEFAULT_CELL_BORDER,
  left: DEFAULT_CELL_BORDER,
  right: DEFAULT_CELL_BORDER,
}
// A borderless cell (`data-legal-borderless` on the table or the cell — the editor's own
// flag) draws no lines in Word either; the grid still lays the columns out.
const NO_CELL_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const NO_CELL_BORDERS = {
  top: NO_CELL_BORDER,
  bottom: NO_CELL_BORDER,
  left: NO_CELL_BORDER,
  right: NO_CELL_BORDER,
}
const isBorderless = (el) => el.hasAttribute('data-legal-borderless')

// Space between the cell edge and its text, in twips (1cm ≈ 567). Matches Word's default
// cell inset (≈0.19cm sides). Overridable per export via the `cellMargins` option.
const DEFAULT_CELL_MARGINS = { top: 40, bottom: 40, left: 108, right: 108 }
let cellMargins = DEFAULT_CELL_MARGINS

const buildLegalNumberingLevels = () =>
  Array.from({ length: LEGAL_NUMBERING_LEVELS }, (_, level) => ({
    level,
    format: LevelFormat.DECIMAL,
    text: `${Array.from({ length: level + 1 }, (_, i) => `%${i + 1}`).join('.')}.`,
    alignment: AlignmentType.START,
    isLegalNumberingStyle: true,
  }))

const makeCounters = () => ({ h2: 0, h3: 0 })

/** @returns {string} literal number prefix for H2/H3, mirroring the editor's CSS counters */
const bumpHeadingCounter = (counters, tag) => {
  if (tag === 'H2') {
    counters.h2 += 1
    counters.h3 = 0
    return `${counters.h2}. `
  }
  if (tag === 'H3') {
    counters.h3 += 1
    return `${counters.h2}.${counters.h3} `
  }
  return ''
}

const NAMED_HIGHLIGHTS = new Set(Object.values(HighlightColor))

const makeTextRun = (text, marks, rev = null) => {
  const opts = {
    text,
    bold: marks.bold || undefined,
    italics: marks.italics || undefined,
    strike: marks.strike || undefined,
    underline: marks.underline ? {} : undefined,
    font: marks.font || undefined,
    size: marks.size || undefined, // half-points
    color: marks.color || undefined, // 6-hex, no '#'
    highlight: marks.highlight || undefined, // named Word highlight
    shading: marks.shadingFill ? { fill: marks.shadingFill } : undefined, // hex cell/run fill
  }
  // Tracked export: emit the run as a native Word revision so Word shows it as a change.
  if (rev?.type === 'insertion') {
    return new InsertedTextRun({ ...opts, id: rev.id, author: rev.author, date: REVISION_DATE })
  }
  if (rev?.type === 'deletion') {
    return new DeletedTextRun({ ...opts, id: rev.id, author: rev.author, date: REVISION_DATE })
  }
  return new TextRun(opts)
}

// Build the Word comment definitions collected during the walk, one thread → one comment.
// NOTE: the Document's `comments.children` takes plain OPTION objects (the library constructs
// each Comment internally) — passing `new Comment(...)` here throws "children is not iterable".
const buildCommentDefinitions = () =>
  trackedCtx.comments.map((c) => ({
    id: c.id,
    author: c.author || 'Reviewer',
    date: REVISION_DATE,
    children: (c.entries.length ? c.entries : [{ text: '' }]).map(
      (entry) =>
        new Paragraph({
          children: [
            new TextRun({ text: entry.author ? `${entry.author}: ${entry.text}` : entry.text }),
          ],
        }),
    ),
  }))

/** Merge inline CSS (font-family/size/color/background) from an element into the mark set. */
const marksFromStyle = (element, marks) => {
  const style = element.style
  if (!style) return marks
  const next = { ...marks }
  if (style.fontFamily) next.font = style.fontFamily.replace(/['"]/g, '').split(',')[0].trim()
  if (style.fontSize) {
    const px = /(-?\d*\.?\d+)px/.exec(style.fontSize)
    const pt = /(-?\d*\.?\d+)pt/.exec(style.fontSize)
    const points = pt ? parseFloat(pt[1]) : px ? parseFloat(px[1]) * 0.75 : null
    if (points) next.size = Math.round(points * 2)
  }
  if (style.color) {
    const hex = toHexFill(style.color)
    if (hex) next.color = hex
  }
  if (style.backgroundColor) {
    const value = style.backgroundColor.trim()
    if (NAMED_HIGHLIGHTS.has(value)) next.highlight = value
    else {
      const hex = toHexFill(value)
      if (hex) next.shadingFill = hex
    }
  }
  return next
}

const decodeBase64Image = (src) => {
  const match = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i.exec(src || '')
  if (!match) return null
  const type = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return { type, bytes }
}

/** Pixel size read from the image bytes themselves (PNG / JPEG / GIF / BMP headers), so an
 *  <img> that only states a width — the editor's image node never stores a height unless the
 *  author resized it — keeps its aspect ratio in Word instead of landing in a 320×200 box. */
const imageNaturalSize = (bytes, type) => {
  const be32 = (i) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0
  const le16 = (i) => bytes[i] | (bytes[i + 1] << 8)
  const le32 = (i) => (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0
  try {
    if (type === 'png' && bytes.length >= 24) return { width: be32(16), height: be32(20) }
    if (type === 'gif' && bytes.length >= 10) return { width: le16(6), height: le16(8) }
    if (type === 'bmp' && bytes.length >= 26) return { width: le32(18), height: le32(22) }
    if (type === 'jpg') {
      let i = 2
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null
        const marker = bytes[i + 1]
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
        if (isSof) return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] }
        i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3])
      }
    }
  } catch {
    return null
  }
  return null
}

const buildImageRun = (imgEl) => {
  const decoded = decodeBase64Image(imgEl.getAttribute('src'))
  if (!decoded) return null // External (non-embedded) image URLs aren't fetched/embedded.

  const widthAttr = parseFloat(imgEl.style?.width || imgEl.getAttribute('width') || '')
  const heightAttr = parseFloat(imgEl.style?.height || imgEl.getAttribute('height') || '')
  const natural = imageNaturalSize(decoded.bytes, decoded.type)
  const ratio = natural && natural.width > 0 && natural.height > 0 ? natural.height / natural.width : null
  // Never wider than the printable area — a logo pasted at full resolution must not push
  // past the page edge in Word.
  const maxWidth = Math.max(100, Math.round(CONTENT_WIDTH_TWIPS / 15))
  let width = Number.isFinite(widthAttr) && widthAttr > 0 ? widthAttr : null
  let height = Number.isFinite(heightAttr) && heightAttr > 0 ? heightAttr : null
  if (!width && !height) {
    width = natural ? Math.min(natural.width, maxWidth) : 320
  } else if (!width && height) {
    width = ratio ? Math.round(height / ratio) : 320
  }
  width = Math.min(width, maxWidth)
  if (!height) height = ratio ? Math.round(width * ratio) : 200

  return new ImageRun({
    type: decoded.type,
    data: decoded.bytes,
    transformation: { width, height },
  })
}

const hasClass = (node, name) => node.classList && node.classList.contains(name)

/** Recursively walk inline content (text + b/i/u/s/mark/a/br/img), accumulating marks. The
 *  `rev` context (insertion/deletion) is inherited from an enclosing <ins>/<del> in tracked
 *  export mode; null otherwise. */
const buildInline = (node, marks, rev = null) => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ? [makeTextRun(node.textContent, marks, rev)] : []
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return []

  const tag = node.tagName
  if (tag === 'BR') return [new TextRun({ text: '', break: 1 })]
  if (tag === 'IMG') {
    const run = buildImageRun(node)
    return run ? [run] : []
  }

  // ── Tracked changes / comments → native Word revisions + comments ──────────────
  if (trackedCtx.enabled) {
    if (tag === 'INS' || hasClass(node, 'legal-insertion')) {
      const childRev = { type: 'insertion', id: trackedCtx.revId++, author: revAuthor(node) }
      return Array.from(node.childNodes).flatMap((c) =>
        buildInline(c, marksFromStyle(node, marks), childRev),
      )
    }
    if (tag === 'DEL' || hasClass(node, 'legal-deletion')) {
      const childRev = { type: 'deletion', id: trackedCtx.revId++, author: revAuthor(node) }
      return Array.from(node.childNodes).flatMap((c) =>
        buildInline(c, marksFromStyle(node, marks), childRev),
      )
    }
    if (tag === 'SPAN' && hasClass(node, 'legal-comment')) {
      const id = trackedCtx.commentId++
      const payload = parseCommentPayload(node.getAttribute('data-comment'))
      trackedCtx.comments.push({
        id,
        author: node.getAttribute('data-author') || 'Reviewer',
        entries: payload?.entries || [],
      })
      const inner = Array.from(node.childNodes).flatMap((c) =>
        buildInline(c, marksFromStyle(node, marks), rev),
      )
      return [
        new CommentRangeStart(id),
        ...inner,
        new CommentRangeEnd(id),
        new TextRun({ children: [new CommentReference(id)] }),
      ]
    }
  }

  let nextMarks = { ...marks }
  if (tag === 'B' || tag === 'STRONG') nextMarks.bold = true
  if (tag === 'I' || tag === 'EM') nextMarks.italics = true
  if (tag === 'U') nextMarks.underline = true
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') nextMarks.strike = true
  if (tag === 'MARK') nextMarks.highlight = HighlightColor.YELLOW
  // font-family / font-size / color / background from inline styles (e.g. imported <span>)
  nextMarks = marksFromStyle(node, nextMarks)

  const children = Array.from(node.childNodes).flatMap((child) =>
    buildInline(child, nextMarks, rev),
  )

  if (tag === 'A') {
    const href = node.getAttribute('href')
    return href && children.length ? [new ExternalHyperlink({ children, link: href })] : children
  }

  return children
}

const revAuthor = (node) => node.getAttribute('data-author') || 'Reviewer'

const buildInlineChildren = (el) =>
  Array.from(el.childNodes).flatMap((child) => buildInline(child, {}))

/** Flat sequence of Paragraphs, one per <li>, each carrying its own numbering level —
 *  this is how Word represents multi-level lists (never literally nested paragraphs). */
const walkList = (listEl, isOrdered, depth) => {
  const paragraphs = []
  Array.from(listEl.children).forEach((li) => {
    if (li.tagName !== 'LI') return
    const inlineNodes = []
    const nestedLists = []
    Array.from(li.childNodes).forEach((child) => {
      if (
        child.nodeType === Node.ELEMENT_NODE &&
        (child.tagName === 'OL' || child.tagName === 'UL')
      ) {
        nestedLists.push(child)
      } else {
        inlineNodes.push(child)
      }
    })
    const runs = inlineNodes.flatMap((node) => buildInline(node, {}))
    paragraphs.push(
      new Paragraph({
        children: runs.length ? runs : [new TextRun('')],
        ...(isOrdered
          ? { numbering: { reference: LEGAL_NUMBERING_REF, level: depth } }
          : { bullet: { level: depth } }),
      }),
    )
    nestedLists.forEach((nested) => {
      paragraphs.push(...walkList(nested, nested.tagName === 'OL', depth + 1))
    })
  })
  return paragraphs
}

const readSpan = (cellEl, attr) => {
  const value = parseInt(cellEl.getAttribute(attr) || '1', 10)
  return Number.isFinite(value) && value > 0 ? value : 1
}

/** Normalize a CSS color (#rgb / #rrggbb / rgb(...)) to a 6-hex string for docx, or null. */
const toHexFill = (value) => {
  if (!value) return null
  const v = value.trim()
  let m = /^#([0-9a-f]{6})$/i.exec(v)
  if (m) return m[1].toUpperCase()
  m = /^#([0-9a-f]{3})$/i.exec(v)
  if (m) {
    return m[1]
      .split('')
      .map((c) => c + c)
      .join('')
      .toUpperCase()
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v)
  if (m) {
    return [m[1], m[2], m[3]]
      .map((n) => Number(n).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  }
  return null
}

/** Cell shading from an explicit background (data-attr wins, then inline style), else header default. */
const cellShading = (cellEl) => {
  const explicit =
    toHexFill(cellEl.getAttribute('data-background-color')) ||
    toHexFill(cellEl.style?.backgroundColor)
  if (explicit) return { fill: explicit }
  if (cellEl.tagName === 'TH') return { fill: 'F2F2F2' }
  return undefined
}

/** This table's OWN rows only — not rows of nested tables inside its cells (querySelectorAll
 *  would recurse into those and corrupt the column count / widths). */
const directRows = (tableEl) => {
  const rows = []
  Array.from(tableEl.children).forEach((child) => {
    if (child.tagName === 'TR') rows.push(child)
    else if (['TBODY', 'THEAD', 'TFOOT'].includes(child.tagName)) {
      Array.from(child.children).forEach((r) => {
        if (r.tagName === 'TR') rows.push(r)
      })
    }
  })
  return rows
}

const directCells = (rowEl) =>
  Array.from(rowEl.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH')

/** Widest row (accounting for colspans) = the table's column count. */
const getColumnCount = (tableEl) => {
  let max = 0
  directRows(tableEl).forEach((tr) => {
    let count = 0
    directCells(tr).forEach((cellEl) => {
      count += readSpan(cellEl, 'colspan')
    })
    max = Math.max(max, count)
  })
  return max || 1
}

/**
 * Fixed column widths (twips), scaled to the printable width. Preference order:
 *  1. the imported per-column widths (from cells' `colwidth`, in px) — faithful to source;
 *  2. otherwise a narrow-label / wide-content split for the common legal-sheet layout.
 * Either way an explicit grid is required — without it Word auto-fits and squishes wide
 * cells to one word per line (which ballooned the export to 16 pages).
 */
const readImportedColumnPx = (tableEl, count) => {
  const widths = new Array(count).fill(0)
  directRows(tableEl).forEach((tr) => {
    let colIndex = 0
    directCells(tr).forEach((cellEl) => {
      const span = readSpan(cellEl, 'colspan')
      const px = (cellEl.getAttribute('colwidth') || '')
        .split(',')
        .map((n) => parseInt(n, 10))
        .filter((n) => Number.isFinite(n) && n > 0)
      for (let i = 0; i < span; i += 1) {
        if (px[i] && !widths[colIndex + i]) widths[colIndex + i] = px[i]
      }
      colIndex += span
    })
  })
  return widths.every((w) => w > 0) ? widths : null
}

const buildColumnWidths = (tableEl, count) => {
  if (count <= 1) return [CONTENT_WIDTH_TWIPS]
  const importedPx = readImportedColumnPx(tableEl, count)
  if (importedPx) {
    // Scale the source's relative column widths to fill the printable width exactly.
    const total = importedPx.reduce((sum, w) => sum + w, 0)
    return importedPx.map((w) => Math.round((w / total) * CONTENT_WIDTH_TWIPS))
  }
  const first = Math.round(CONTENT_WIDTH_TWIPS * 0.24)
  const rest = Math.round((CONTENT_WIDTH_TWIPS - first) / (count - 1))
  return [first, ...Array.from({ length: count - 1 }, () => rest)]
}

const buildTable = (tableEl) => {
  const columnWidths = buildColumnWidths(tableEl, getColumnCount(tableEl))
  const tableBorderless = isBorderless(tableEl)

  const rows = directRows(tableEl)
    .map((tr) => {
      // Track the running column position so each cell gets an EXPLICIT width. Setting the
      // table grid alone wasn't enough — Word left the content column at ~40% page width.
      // Explicit per-cell widths (summed across the cell's colspan) force the fixed layout.
      let colIndex = 0
      const cells = directCells(tr).map((cellEl) => {
        const colSpan = readSpan(cellEl, 'colspan')
        const widthTwips = columnWidths
          .slice(colIndex, colIndex + colSpan)
          .reduce((sum, w) => sum + w, 0)
        colIndex += colSpan
        const blocks = walkBlocks(cellEl, makeCounters())
        const children = blocks.length
          ? blocks
          : [new Paragraph({ children: buildInlineChildren(cellEl) })]
        return new TableCell({
          children,
          columnSpan: colSpan,
          rowSpan: readSpan(cellEl, 'rowspan'),
          width: { size: widthTwips || CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
          margins: cellMargins,
          shading: cellShading(cellEl),
          borders: tableBorderless || isBorderless(cellEl) ? NO_CELL_BORDERS : DEFAULT_CELL_BORDERS,
        })
      })
      return cells.length ? new TableRow({ children: cells }) : null
    })
    .filter(Boolean)

  if (!rows.length) return null

  return new Table({
    rows,
    columnWidths,
    layout: TableLayoutType.FIXED,
    width: {
      size: columnWidths.reduce((sum, w) => sum + w, 0),
      type: WidthType.DXA,
    },
  })
}

const buildBlockquote = (el) => {
  const paragraphs = []
  Array.from(el.children).forEach((child) => {
    if (child.tagName === 'P') {
      const runs = buildInlineChildren(child)
      paragraphs.push(
        new Paragraph({
          children: runs.length ? runs : [new TextRun('')],
          indent: { left: 720 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'CCCCCC', space: 8 } },
        }),
      )
    } else {
      paragraphs.push(...walkBlockElement(child, makeCounters()))
    }
  })
  return paragraphs
}

const ALIGN_MAP = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
}
const alignmentOf = (el) => ALIGN_MAP[el.style?.textAlign] || undefined

function walkBlockElement(el, counters) {
  const tag = el.tagName

  if (tag === 'H1') {
    return [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: alignmentOf(el),
        children: buildInlineChildren(el),
      }),
    ]
  }
  if (tag === 'H2' || tag === 'H3') {
    const prefix = bumpHeadingCounter(counters, tag)
    const runs = buildInlineChildren(el)
    const withPrefix = prefix ? [new TextRun({ text: prefix, bold: true }), ...runs] : runs
    return [
      new Paragraph({
        heading: tag === 'H2' ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        alignment: alignmentOf(el),
        children: withPrefix.length ? withPrefix : [new TextRun('')],
      }),
    ]
  }
  if (tag === 'P') {
    const runs = buildInlineChildren(el)
    return [
      new Paragraph({
        alignment: alignmentOf(el),
        children: runs.length ? runs : [new TextRun('')],
      }),
    ]
  }
  if (tag === 'UL' || tag === 'OL') {
    return walkList(el, tag === 'OL', 0)
  }
  if (tag === 'BLOCKQUOTE') {
    return buildBlockquote(el)
  }
  if (tag === 'HR') {
    return [
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' } },
        children: [],
      }),
    ]
  }
  if (tag === 'TABLE') {
    const table = buildTable(el)
    return table ? [table] : []
  }
  // A block-level image — the editor's image node is `inline: false`, so a letterhead logo
  // serializes as a top-level <img>, not inside a <p>. Word only knows images as runs, so it
  // gets a paragraph of its own; `data-align` is what LegalDocumentImage renders its
  // alignment as.
  if (tag === 'IMG') {
    const run = buildImageRun(el)
    if (!run) return []
    const align = el.getAttribute('data-align') || el.style?.textAlign
    return [new Paragraph({ alignment: ALIGN_MAP[align] || undefined, children: [run] })]
  }
  // Unrecognized wrapper (e.g. a stray <div>) — recurse into its children.
  return walkBlocks(el, counters)
}

function walkBlocks(containerEl, counters) {
  return Array.from(containerEl.children).flatMap((el) => walkBlockElement(el, counters))
}

const downloadBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob)
  const link = window.document.createElement('a')
  link.href = url
  link.download = fileName
  window.document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** Merge an imported pageSetup with defaults, filling any missing fields. */
const resolvePage = (pageSetup) => ({
  size: { ...DEFAULT_PAGE.size, ...(pageSetup?.size || {}) },
  margins: {
    ...DEFAULT_PAGE.margins,
    ...Object.fromEntries(
      Object.entries(pageSetup?.margins || {}).filter(([, v]) => Number.isFinite(v)),
    ),
  },
})

/**
 * @param {string} html - the editor's serialized content (contract_content)
 * @param {object} [options]
 * @param {string} [options.fileName]
 * @param {string} [options.font] - document-wide default font (Arial ≈ these legal sheets).
 * @param {number} [options.fontSizePt] - document-wide default size in points (≈8pt here).
 * @param {{top?:number,bottom?:number,left?:number,right?:number}} [options.cellMargins] -
 *   space around cell text in twips (1cm ≈ 567). Defaults to Word's ≈0.19cm side inset.
 * @param {{size?:{width,height},margins?:{top,right,bottom,left}}} [options.pageSetup] -
 *   page size + margins (twips) captured from the imported source .docx, so the exported
 *   document reproduces the SAME page geometry instead of a generic A4 + 2cm.
 */
export async function exportHtmlToDocx(
  html,
  {
    fileName = 'contract.docx',
    font = 'Arial',
    fontSizePt = 8,
    cellMargins: cellMarginsOption,
    pageSetup,
    trackedChanges = false,
  } = {},
) {
  trackedCtx = { enabled: Boolean(trackedChanges), revId: 1, commentId: 1, comments: [] }
  cellMargins = { ...DEFAULT_CELL_MARGINS, ...(cellMarginsOption || {}) }
  currentPage = resolvePage(pageSetup)
  CONTENT_WIDTH_TWIPS = Math.max(
    1000,
    currentPage.size.width - currentPage.margins.left - currentPage.margins.right,
  )

  const parsedDoc = new DOMParser().parseFromString(html || '<p></p>', 'text/html')
  const children = walkBlocks(parsedDoc.body, makeCounters())

  // Comments are collected while walking the body above, so build them after walkBlocks ran.
  const commentDefinitions = trackedCtx.enabled ? buildCommentDefinitions() : []

  const wordDocument = new Document({
    styles: {
      default: {
        document: {
          run: { font, size: Math.round(fontSizePt * 2) }, // docx sizes are half-points
        },
      },
    },
    numbering: {
      config: [{ reference: LEGAL_NUMBERING_REF, levels: buildLegalNumberingLevels() }],
    },
    ...(commentDefinitions.length ? { comments: { children: commentDefinitions } } : {}),
    sections: [
      {
        properties: {
          page: {
            size: { width: currentPage.size.width, height: currentPage.size.height },
            margin: { ...currentPage.margins },
          },
        },
        children: children.length ? children : [new Paragraph({ children: [] })],
      },
    ],
  })

  const blob = await Packer.toBlob(wordDocument)
  downloadBlob(blob, fileName)
}
