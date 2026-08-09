/**
 * Formatting-preserving .docx → HTML importer.
 *
 * Reads the document's OOXML directly (word/document.xml + numbering.xml) instead of using
 * a "clean HTML" converter, so Word's DIRECT formatting survives into the editor and, from
 * there, back out to the .docx export:
 *   - run formatting: bold / italic / underline / strike, font family, font size, color,
 *     highlight / run shading
 *   - paragraph alignment (incl. justify) and Heading 1–3 styles
 *   - tables: column widths (tblGrid), gridSpan (colspan), and cell shading (w:shd fill)
 *   - numbered / bulleted lists (numPr), nested by level
 *
 * Tracked changes: by default they are resolved to the ACCEPTED text (insertions kept,
 * deletions dropped) so a template is a clean base document. Pass `{ trackedChanges: true }`
 * (review mode) to instead bring Word's revisions back in AS redline — insertions become
 * <ins>, deletions <del>, and commented ranges a <span class="legal-comment"> — so a lawyer
 * can keep reviewing after a round-trip through Word.
 */
import JSZip from 'jszip'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

// ─── XML helpers (namespace-aware) ──────────────────────────────────────────────
const childrenOf = (node, localName) => {
  const out = []
  for (const child of node.childNodes) {
    if (child.nodeType === 1 && child.localName === localName) out.push(child)
  }
  return out
}
const firstOf = (node, localName) => childrenOf(node, localName)[0] || null
const wAttr = (node, name) => (node ? node.getAttributeNS(W_NS, name) : null)
/** OOXML toggle: element present and not explicitly turned off. */
const toggleOn = (rPr, localName) => {
  const el = rPr && firstOf(rPr, localName)
  if (!el) return false
  const val = wAttr(el, 'val')
  return val !== 'false' && val !== '0' && val !== 'none'
}

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const TWIPS_PER_PX = 15 // ≈ 96dpi: 1px = 15 twips

// ─── Runs ───────────────────────────────────────────────────────────────────────
const collectRunText = (run) => {
  let text = ''
  for (const child of run.childNodes) {
    if (child.nodeType !== 1) continue
    // `delText` carries the text of a tracked deletion (w:del) — same as `t` for our purposes.
    if (child.localName === 't' || child.localName === 'delText') text += child.textContent
    else if (child.localName === 'tab') text += '\t'
    else if (child.localName === 'br' || child.localName === 'cr') text += '\n'
    else if (child.localName === 'noBreakHyphen') text += '-'
  }
  return text
}

/** Escape a string for use inside a double-quoted HTML attribute value. */
const escapeAttr = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/**
 * word/comments.xml → Map<id, { author, date, text }>. Each Word comment becomes one entry;
 * its paragraphs are flattened to a single text string (the editor stores a comment thread).
 */
const buildCommentsLookup = (commentsXml) => {
  const lookup = new Map()
  if (!commentsXml) return lookup
  const doc = new DOMParser().parseFromString(commentsXml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return lookup
  const comments = doc.getElementsByTagNameNS(W_NS, 'comment')
  for (const comment of comments) {
    const id = wAttr(comment, 'id')
    if (id == null) continue
    const tNodes = comment.getElementsByTagNameNS(W_NS, 't')
    let text = ''
    for (const t of tNodes) text += t.textContent
    lookup.set(id, {
      author: wAttr(comment, 'author') || 'Reviewer',
      date: wAttr(comment, 'date') || null,
      text: text.trim(),
    })
  }
  return lookup
}

/** JSON comment-thread payload the editor stores in data-comment (single imported entry). */
const commentPayloadJson = (meta) =>
  JSON.stringify({
    entries: [
      {
        id: `imported-${Math.abs(hashString(meta.text + meta.author))}`,
        text: meta.text,
        author: meta.author,
        ...(meta.date ? { createdAt: meta.date } : {}),
      },
    ],
  })

// Small stable hash so a re-import of the same comment keeps the same entry id (no Date/random).
const hashString = (str) => {
  let hash = 0
  const s = String(str || '')
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash << 5) - hash + s.charCodeAt(i)
    hash |= 0
  }
  return hash
}

const runToHtml = (run) => {
  const text = collectRunText(run)
  if (!text) return ''

  let html = escapeHtml(text).replace(/\n/g, '<br>').replace(/\t/g, '&#9;&#9;')

  const rPr = firstOf(run, 'rPr')
  if (rPr) {
    const styles = []
    const rFonts = firstOf(rPr, 'rFonts')
    const font = rFonts && wAttr(rFonts, 'ascii')
    if (font) styles.push(`font-family: ${font}`)
    const sz = firstOf(rPr, 'sz')
    const szVal = sz && wAttr(sz, 'val')
    if (szVal) styles.push(`font-size: ${Number(szVal) / 2}pt`)
    const color = firstOf(rPr, 'color')
    const colorVal = color && wAttr(color, 'val')
    if (colorVal && colorVal !== 'auto') styles.push(`color: #${colorVal}`)
    // Word's highlighter (w:highlight) → the editor's highlight mark (<mark>), so a reviewer's
    // yellow-marked passages come in still marked. Run shading (w:shd) stays a background color.
    const highlight = firstOf(rPr, 'highlight')
    const highlightVal = highlight && wAttr(highlight, 'val')
    let highlighted = false
    if (highlightVal && highlightVal !== 'none') {
      highlighted = true
    } else {
      const shd = firstOf(rPr, 'shd')
      const fill = shd && wAttr(shd, 'fill')
      if (fill && fill !== 'auto') styles.push(`background-color: #${fill}`)
    }
    if (styles.length) html = `<span style="${styles.join('; ')}">${html}</span>`

    if (toggleOn(rPr, 'b')) html = `<strong>${html}</strong>`
    if (toggleOn(rPr, 'i')) html = `<em>${html}</em>`
    if (toggleOn(rPr, 'u')) html = `<u>${html}</u>`
    if (toggleOn(rPr, 'strike') || toggleOn(rPr, 'dstrike')) html = `<s>${html}</s>`
    if (highlighted) html = `<mark>${html}</mark>`
  }
  return html
}

const insWrap = (el, inner) =>
  `<ins class="legal-insertion" data-author="${escapeAttr(wAttr(el, 'author') || 'Reviewer')}">${inner}</ins>`
const delWrap = (el, inner) =>
  `<del class="legal-deletion" data-author="${escapeAttr(wAttr(el, 'author') || 'Reviewer')}">${inner}</del>`

/**
 * Inline content of a paragraph.
 *
 * In the default (clean-base) import, tracked changes are resolved — insertions are kept as
 * plain text and deletions dropped. In tracked-changes import (`ctx.tracked`), insertions are
 * wrapped in <ins>, deletions in <del>, and text between a commentRangeStart/End is wrapped in
 * a <span class="legal-comment"> — so the editor re-derives the redline and reviewing continues.
 */
const paragraphInlineHtml = (para, ctx) => {
  let html = ''
  // While a comment range is open, runs accumulate here so we can wrap them on rangeEnd.
  let commentBuf = null // { id, parts }
  const emit = (str) => {
    if (commentBuf) commentBuf.parts += str
    else html += str
  }

  for (const child of para.childNodes) {
    if (child.nodeType !== 1) continue
    const ln = child.localName

    if (ln === 'r') emit(runToHtml(child))
    else if (ln === 'ins') {
      const inner = childrenOf(child, 'r').map(runToHtml).join('')
      emit(ctx.tracked ? insWrap(child, inner) : inner)
    } else if (ln === 'del') {
      const inner = childrenOf(child, 'r').map(runToHtml).join('')
      if (ctx.tracked && inner) emit(delWrap(child, inner)) // else: drop the deleted text
    } else if (ln === 'hyperlink') {
      let inner = ''
      childrenOf(child, 'r').forEach((r) => (inner += runToHtml(r)))
      childrenOf(child, 'ins').forEach((ins) =>
        childrenOf(ins, 'r').forEach((r) => (inner += runToHtml(r))),
      )
      emit(inner)
    } else if (ln === 'commentRangeStart' && ctx.tracked && ctx.comments.size) {
      commentBuf = { id: wAttr(child, 'id'), parts: '' }
    } else if (ln === 'commentRangeEnd' && ctx.tracked && commentBuf) {
      const meta = ctx.comments.get(commentBuf.id)
      const inner = commentBuf.parts
      commentBuf = null
      if (meta) {
        html += `<span class="legal-comment" data-author="${escapeAttr(meta.author)}" data-comment="${escapeAttr(
          commentPayloadJson(meta),
        )}">${inner}</span>`
      } else {
        html += inner
      }
    }
    // commentReference, proofErr, bookmark* → skipped
  }
  if (commentBuf) html += commentBuf.parts // safety: unterminated comment range
  return html
}

// ─── Paragraph properties ────────────────────────────────────────────────────────
const HEADING_STYLE = /^(?:heading|berschrift)\s*([1-3])$/i

const readParagraphProps = (para) => {
  const pPr = firstOf(para, 'pPr')
  let align = null
  let headingLevel = null
  let numId = null
  let ilvl = 0
  if (pPr) {
    const jc = firstOf(pPr, 'jc')
    const jcVal = jc && wAttr(jc, 'val')
    if (jcVal === 'both' || jcVal === 'distribute') align = 'justify'
    else if (jcVal === 'center' || jcVal === 'right' || jcVal === 'left') align = jcVal

    const pStyle = firstOf(pPr, 'pStyle')
    const styleId = pStyle && wAttr(pStyle, 'val')
    const headingMatch = styleId && HEADING_STYLE.exec(styleId.replace(/\s+/g, ''))
    if (headingMatch) headingLevel = Number(headingMatch[1])

    const numPr = firstOf(pPr, 'numPr')
    if (numPr) {
      const numIdEl = firstOf(numPr, 'numId')
      const ilvlEl = firstOf(numPr, 'ilvl')
      numId = numIdEl && wAttr(numIdEl, 'val')
      ilvl = ilvlEl ? Number(wAttr(ilvlEl, 'val')) || 0 : 0
    }
  }
  return { align, headingLevel, numId, ilvl }
}

// ─── Numbering (numId → bullet vs ordered) ───────────────────────────────────────
const buildNumberingLookup = (numberingXml) => {
  const lookup = new Map() // numId -> { levels: Map<ilvl, 'bullet'|'ordered'> }
  if (!numberingXml) return lookup
  const doc = new DOMParser().parseFromString(numberingXml, 'application/xml')
  const root = doc.documentElement
  const abstractFormats = new Map() // abstractNumId -> Map<ilvl, kind>
  childrenOf(root, 'abstractNum').forEach((abs) => {
    const absId = wAttr(abs, 'abstractNumId')
    const levels = new Map()
    childrenOf(abs, 'lvl').forEach((lvl) => {
      const ilvl = Number(wAttr(lvl, 'ilvl')) || 0
      const numFmt = firstOf(lvl, 'numFmt')
      const fmt = numFmt && wAttr(numFmt, 'val')
      levels.set(ilvl, fmt === 'bullet' ? 'bullet' : 'ordered')
    })
    abstractFormats.set(absId, levels)
  })
  childrenOf(root, 'num').forEach((num) => {
    const numId = wAttr(num, 'numId')
    const absRef = firstOf(num, 'abstractNumId')
    const absId = absRef && wAttr(absRef, 'val')
    lookup.set(numId, abstractFormats.get(absId) || new Map())
  })
  return lookup
}

const listKind = (numberingLookup, numId, ilvl) => {
  const levels = numberingLookup.get(numId)
  return (levels && levels.get(ilvl)) || 'ordered'
}

// ─── Block sequence → HTML (paragraphs, headings, lists, tables) ──────────────────
const blocksToHtml = (container, ctx) => {
  let html = ''
  const listStack = [] // [{ tag: 'ol'|'ul', ilvl }]

  const closeListsTo = (depth) => {
    while (listStack.length > depth) {
      html += `</li></${listStack.pop().tag}>`
    }
  }

  for (const node of container.childNodes) {
    if (node.nodeType !== 1) continue

    if (node.localName === 'p') {
      const props = readParagraphProps(node)
      const inner = paragraphInlineHtml(node, ctx)

      if (props.numId) {
        const kind = listKind(ctx.numbering, props.numId, props.ilvl)
        const tag = kind === 'bullet' ? 'ul' : 'ol'
        const targetDepth = props.ilvl + 1
        if (listStack.length < targetDepth) {
          // open nested list(s)
          while (listStack.length < targetDepth) {
            html += `<${tag}><li>`
            listStack.push({ tag, ilvl: listStack.length })
          }
        } else {
          closeListsTo(targetDepth)
          html += '</li><li>'
        }
        html += inner
        continue
      }

      closeListsTo(0)
      if (props.headingLevel) {
        html += `<h${props.headingLevel}>${inner}</h${props.headingLevel}>`
      } else {
        const style = props.align ? ` style="text-align: ${props.align}"` : ''
        html += `<p${style}>${inner || '<br>'}</p>`
      }
    } else if (node.localName === 'tbl') {
      closeListsTo(0)
      html += tableToHtml(node, ctx)
    }
  }
  closeListsTo(0)
  return html
}

// ─── Tables ──────────────────────────────────────────────────────────────────────
const tableToHtml = (tbl, ctx) => {
  const grid = firstOf(tbl, 'tblGrid')
  const colTwips = grid ? childrenOf(grid, 'gridCol').map((g) => Number(wAttr(g, 'w')) || 0) : []
  const colPx = colTwips.map((tw) => Math.max(1, Math.round(tw / TWIPS_PER_PX)))

  let rowsHtml = ''
  childrenOf(tbl, 'tr').forEach((tr) => {
    let colIndex = 0
    let cellsHtml = ''
    childrenOf(tr, 'tc').forEach((tc) => {
      const tcPr = firstOf(tc, 'tcPr')
      const gridSpanEl = tcPr && firstOf(tcPr, 'gridSpan')
      const span = gridSpanEl ? Number(wAttr(gridSpanEl, 'val')) || 1 : 1
      const shd = tcPr && firstOf(tcPr, 'shd')
      const fill = shd && wAttr(shd, 'fill')
      const spannedPx = colPx.slice(colIndex, colIndex + span)
      colIndex += span

      const attrs = []
      if (span > 1) attrs.push(`colspan="${span}"`)
      if (spannedPx.length) attrs.push(`colwidth="${spannedPx.join(',')}"`)
      if (fill && fill !== 'auto') {
        attrs.push(`style="background-color: #${fill}"`)
        attrs.push(`data-background-color="#${fill}"`)
      }
      const inner = blocksToHtml(tc, ctx) || '<p><br></p>'
      cellsHtml += `<td ${attrs.join(' ')}>${inner}</td>`
    })
    rowsHtml += `<tr>${cellsHtml}</tr>`
  })

  return `<table><tbody>${rowsHtml}</tbody></table>`
}

// ─── Entry point ──────────────────────────────────────────────────────────────────
/**
 * @param {File} file
 * @returns {Promise<{ html: string, warnings: string[] }>}
 */
export async function importDocxToHtml(file, { trackedChanges = false } = {}) {
  const warnings = []
  const zip = await JSZip.loadAsync(await file.arrayBuffer())

  const documentXml = await zip.file('word/document.xml')?.async('string')
  if (!documentXml) {
    throw new Error('Not a valid .docx file (missing word/document.xml).')
  }
  const numberingXml = await zip.file('word/numbering.xml')?.async('string')
  // Only needed for tracked-changes import — maps comment ids to their author + text.
  const commentsXml = trackedChanges ? await zip.file('word/comments.xml')?.async('string') : null

  const doc = new DOMParser().parseFromString(documentXml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('Could not parse the document XML.')
  }
  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0]
  if (!body) throw new Error('Document has no body.')

  const ctx = {
    numbering: buildNumberingLookup(numberingXml),
    tracked: Boolean(trackedChanges),
    comments: buildCommentsLookup(commentsXml),
  }
  const html = blocksToHtml(body, ctx)
  return { html, warnings, pageSetup: readPageSetup(body) }
}

/**
 * Read the section's page size + margins (twips) so the export can reproduce the source
 * document's exact page geometry instead of falling back to a generic A4 + 2cm.
 * @returns {{ size: {width:number,height:number}, margins: {top,right,bottom,left} } | null}
 */
function readPageSetup(body) {
  const sectPr = firstOf(body, 'sectPr')
  if (!sectPr) return null
  const pgSz = firstOf(sectPr, 'pgSz')
  const pgMar = firstOf(sectPr, 'pgMar')
  const num = (node, name) => {
    const v = node && Number(wAttr(node, name))
    return Number.isFinite(v) ? v : null
  }
  const size =
    pgSz && num(pgSz, 'w') && num(pgSz, 'h')
      ? { width: num(pgSz, 'w'), height: num(pgSz, 'h') }
      : null
  const margins = pgMar
    ? {
        top: num(pgMar, 'top'),
        right: num(pgMar, 'right'),
        bottom: num(pgMar, 'bottom'),
        left: num(pgMar, 'left'),
      }
    : null
  if (!size && !margins) return null
  return { size, margins }
}
