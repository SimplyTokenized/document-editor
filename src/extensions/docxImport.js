/**
 * Formatting-preserving .docx → HTML importer.
 *
 * Reads the document's OOXML directly (word/document.xml + numbering.xml) instead of using
 * a "clean HTML" converter, so Word's DIRECT formatting survives into the editor and, from
 * there, back out to the .docx export:
 *   - run formatting: bold / italic / underline / strike, font family, font size, color,
 *     highlight / run shading — resolved through Word's style cascade (document defaults,
 *     paragraph style, character style, direct formatting), so text formatted only by its
 *     style keeps that look
 *   - paragraph alignment (incl. justify) and Heading 1–3 styles, with their numbering —
 *     Word's own (numPr, directly or through the style) or typed ("1.1 Introduction"),
 *     either way handed to the editor's automatic heading numbering
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
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const EMU_PER_PX = 9525 // 914400 EMU per inch / 96 px

const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' }

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

/** A picture in a run (w:drawing → a:blip r:embed) as an embedded <img>, sized from the
 *  drawing's extent. The bytes come from the package's media parts, loaded up front by
 *  `loadImages` — the walk itself is synchronous. Formats the editor cannot show (EMF/WMF)
 *  were skipped there and come back as a warning, not a broken image. */
const drawingToHtml = (drawing, ctx) => {
  const blip = drawing.getElementsByTagNameNS(A_NS, 'blip')[0]
  const rId = blip && blip.getAttributeNS(R_NS, 'embed')
  const src = rId && ctx.images ? ctx.images.get(rId) : null
  if (!src) {
    if (ctx.warnings && rId) ctx.warnings.push(`Image ${rId} could not be imported.`)
    return ''
  }
  const extent = drawing.getElementsByTagNameNS(WP_NS, 'extent')[0]
  const cx = extent ? Number(extent.getAttribute('cx')) : 0
  const cy = extent ? Number(extent.getAttribute('cy')) : 0
  const size =
    cx > 0 && cy > 0
      ? ` width="${Math.round(cx / EMU_PER_PX)}" height="${Math.round(cy / EMU_PER_PX)}"`
      : ''
  return `<img src="${src}"${size}>`
}

const runToHtml = (run, ctx = {}) => {
  const drawing = firstOf(run, 'drawing')
  if (drawing) return drawingToHtml(drawing, ctx)
  const text = collectRunText(run)
  if (!text) return ''

  let html = escapeHtml(text).replace(/\n/g, '<br>').replace(/\t/g, '&#9;&#9;')

  const rPr = firstOf(run, 'rPr')
  const rStyleId = rPr && wAttr(firstOf(rPr, 'rStyle'), 'val')
  // Word's cascade, nearest wins: the paragraph's resolved defaults + style, then the run's
  // character style, then the run's own direct formatting.
  const props = {
    ...(ctx.paragraphRunProps || {}),
    ...(rStyleId && ctx.styles ? styleRunProps(ctx.styles, rStyleId, ctx.themeFonts) : {}),
    ...readRunProps(rPr, ctx.themeFonts),
  }

  const styles = []
  if (props.font) styles.push(`font-family: ${props.font.replace(/["<>;]/g, '')}`)
  if (props.size) styles.push(`font-size: ${props.size}pt`)
  if (props.color) styles.push(`color: #${props.color}`)
  let highlighted = false
  if (rPr) {
    // Word's highlighter (w:highlight) → the editor's highlight mark (<mark>), so a reviewer's
    // yellow-marked passages come in still marked. Run shading (w:shd) stays a background color.
    const highlight = firstOf(rPr, 'highlight')
    const highlightVal = highlight && wAttr(highlight, 'val')
    if (highlightVal && highlightVal !== 'none') {
      highlighted = true
    } else {
      const shd = firstOf(rPr, 'shd')
      const fill = shd && wAttr(shd, 'fill')
      if (fill && fill !== 'auto') styles.push(`background-color: #${fill}`)
    }
  }
  if (styles.length) html = `<span style="${styles.join('; ')}">${html}</span>`

  if (props.bold) html = `<strong>${html}</strong>`
  if (props.italic) html = `<em>${html}</em>`
  if (props.underline) html = `<u>${html}</u>`
  if (props.strike) html = `<s>${html}</s>`
  if (highlighted) html = `<mark>${html}</mark>`
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

    if (ln === 'r') emit(runToHtml(child, ctx))
    else if (ln === 'ins') {
      const inner = childrenOf(child, 'r').map((r) => runToHtml(r, ctx)).join('')
      emit(ctx.tracked ? insWrap(child, inner) : inner)
    } else if (ln === 'del') {
      const inner = childrenOf(child, 'r').map((r) => runToHtml(r, ctx)).join('')
      if (ctx.tracked && inner) emit(delWrap(child, inner)) // else: drop the deleted text
    } else if (ln === 'hyperlink') {
      let inner = ''
      childrenOf(child, 'r').forEach((r) => (inner += runToHtml(r, ctx)))
      childrenOf(child, 'ins').forEach((ins) =>
        childrenOf(ins, 'r').forEach((r) => (inner += runToHtml(r, ctx))),
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

/**
 * word/styles.xml → Map<styleId, { basedOn, headingLevel, numId, ilvl }> for paragraph styles.
 * Word very often numbers through the STYLE rather than the paragraph ("List Number", or a
 * Heading 1 tied to a multilevel list), so a paragraph with no numPr of its own can still be
 * a numbered one.
 */
const buildStyleLookup = (stylesXml) => {
  const lookup = new Map()
  // Paragraph AND character styles (a run's rStyle), plus the document-wide defaults the
  // cascade starts from and the style a paragraph without a pStyle uses.
  const part = { styles: lookup, defaultParagraphStyle: null, defaultRunPr: null }
  if (!stylesXml) return part
  const doc = new DOMParser().parseFromString(stylesXml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return part
  const docDefaults = firstOf(doc.documentElement, 'docDefaults')
  const rPrDefault = docDefaults && firstOf(docDefaults, 'rPrDefault')
  part.defaultRunPr = rPrDefault && firstOf(rPrDefault, 'rPr')
  childrenOf(doc.documentElement, 'style').forEach((style) => {
    const type = wAttr(style, 'type')
    if (type !== 'paragraph' && type !== 'character') return
    const styleId = wAttr(style, 'styleId')
    if (type === 'paragraph' && wAttr(style, 'default') === '1') part.defaultParagraphStyle = styleId
    const pPr = firstOf(style, 'pPr')
    const numPr = pPr && firstOf(pPr, 'numPr')
    const numIdEl = numPr && firstOf(numPr, 'numId')
    const ilvlEl = numPr && firstOf(numPr, 'ilvl')
    // The name as well as the id: Word keeps "heading 1" as the NAME in every UI language,
    // while the id is localised ("berschrift1").
    const headingMatch =
      HEADING_STYLE.exec((styleId || '').replace(/\s+/g, '')) ||
      HEADING_STYLE.exec((wAttr(firstOf(style, 'name'), 'val') || '').replace(/\s+/g, ''))
    lookup.set(styleId, {
      basedOn: wAttr(firstOf(style, 'basedOn'), 'val'),
      headingLevel: type === 'paragraph' && headingMatch ? Number(headingMatch[1]) : null,
      numId: numIdEl ? wAttr(numIdEl, 'val') : null,
      ilvl: ilvlEl ? Number(wAttr(ilvlEl, 'val')) || 0 : null,
      rPr: firstOf(style, 'rPr'),
    })
  })
  return part
}

/** word/theme/theme1.xml → the { major, minor } Latin typefaces an rFonts theme reference names. */
const buildThemeFonts = (themeXml) => {
  if (!themeXml) return {}
  const doc = new DOMParser().parseFromString(themeXml, 'application/xml')
  const typeface = (name) =>
    doc.getElementsByTagNameNS(A_NS, name)[0]?.getElementsByTagNameNS(A_NS, 'latin')[0]?.getAttribute('typeface') ||
    null
  return { major: typeface('majorFont'), minor: typeface('minorFont') }
}

/**
 * The run properties an rPr STATES — and only those, so the cascade's layers merge by
 * spreading, the nearer one overriding. Toggles an rPr turns off explicitly (`<w:b w:val="0"/>`)
 * come through as false, which is how a run un-bolds text its style made bold.
 */
const readRunProps = (rPr, themeFonts = {}) => {
  if (!rPr) return {}
  const props = {}
  const rFonts = firstOf(rPr, 'rFonts')
  if (rFonts) {
    // A theme reference outranks a named font in Word — and Word drops the named one when it
    // re-saves — so the theme's typeface wins whenever the package has a theme to resolve it.
    const theme = wAttr(rFonts, 'asciiTheme') || wAttr(rFonts, 'hAnsiTheme')
    const font =
      (theme && themeFonts[theme.startsWith('major') ? 'major' : 'minor']) ||
      wAttr(rFonts, 'ascii') ||
      wAttr(rFonts, 'hAnsi')
    if (font) props.font = font
  }
  const size = wAttr(firstOf(rPr, 'sz'), 'val')
  if (size) props.size = Number(size) / 2
  const color = wAttr(firstOf(rPr, 'color'), 'val')
  if (color) props.color = color === 'auto' ? null : color
  for (const [key, names] of [
    ['bold', ['b']],
    ['italic', ['i']],
    ['underline', ['u']],
    ['strike', ['strike', 'dstrike']],
  ]) {
    if (names.some((name) => firstOf(rPr, name))) props[key] = names.some((name) => toggleOn(rPr, name))
  }
  return props
}

/** Run properties a style gives: its basedOn ancestors first, so the nearer style wins. */
const styleRunProps = (styles, styleId, themeFonts) => {
  const chain = []
  const seen = new Set()
  for (let id = styleId; id && styles.has(id) && !seen.has(id); id = styles.get(id).basedOn) {
    seen.add(id)
    chain.unshift(styles.get(id))
  }
  return Object.assign({}, ...chain.map((style) => readRunProps(style.rPr, themeFonts)))
}

const readParagraphProps = (para, styles = new Map()) => {
  const pPr = firstOf(para, 'pPr')
  let align = null
  let styleId = null
  let numId = null
  let ilvl = null
  if (pPr) {
    const jc = firstOf(pPr, 'jc')
    const jcVal = jc && wAttr(jc, 'val')
    if (jcVal === 'both' || jcVal === 'distribute') align = 'justify'
    else if (jcVal === 'center' || jcVal === 'right' || jcVal === 'left') align = jcVal

    const pStyle = firstOf(pPr, 'pStyle')
    styleId = pStyle && wAttr(pStyle, 'val')

    const numPr = firstOf(pPr, 'numPr')
    if (numPr) {
      const numIdEl = firstOf(numPr, 'numId')
      const ilvlEl = firstOf(numPr, 'ilvl')
      numId = numIdEl && wAttr(numIdEl, 'val')
      ilvl = ilvlEl ? Number(wAttr(ilvlEl, 'val')) || 0 : null
    }
  }

  // Heading level comes from the paragraph's own style only (basing a style on Heading 1
  // inherits its look, not its place in the outline); numbering the paragraph does not set
  // itself is inherited up the basedOn chain, as Word does.
  let headingLevel = null
  const seen = new Set()
  for (let id = styleId; id && !seen.has(id); id = styles.get(id).basedOn) {
    seen.add(id)
    const style = styles.get(id)
    if (!style) {
      // No styles part, or a style it does not define — the id alone still says "Heading 2".
      const match = id === styleId && HEADING_STYLE.exec(id.replace(/\s+/g, ''))
      if (match) headingLevel = Number(match[1])
      break
    }
    if (id === styleId) headingLevel = style.headingLevel
    if (numId == null && style.numId != null) numId = style.numId
    if (ilvl == null && style.ilvl != null) ilvl = style.ilvl
  }
  // numId 0 is Word's explicit "no numbering": a paragraph switching off its style's list.
  if (numId === '0') numId = null
  return { align, headingLevel, numId, ilvl: ilvl ?? 0, styleId }
}

/** "1.", "1.1", "17.10." followed by whitespace. The dot is required, so a heading that merely
 *  starts with a year ("2024 Annual Report") keeps its text. */
const LEADING_NUMBER = /^\s*\d+\.(?:\d+\.?)*(?=\s)\s*/

/**
 * A heading whose number was TYPED ("1.1 Introduction") rather than produced by Word's
 * numbering. Removes the typed number from the paragraph's text and reports whether there
 * was one, so the editor numbers the heading instead — otherwise the number shows twice
 * ("1.1 1.1 Introduction") and no longer follows when sections are added or moved.
 */
const stripLeadingNumber = (para) => {
  const pieces = Array.from(para.getElementsByTagNameNS(W_NS, '*')).filter(
    (el) => el.localName === 't' || (el.localName === 'tab' && el.parentNode?.localName === 'r'),
  )
  const text = pieces.map((el) => (el.localName === 'tab' ? '\t' : el.textContent)).join('')
  const match = LEADING_NUMBER.exec(text)
  if (!match) return false

  let remaining = match[0].length
  for (const el of pieces) {
    if (remaining <= 0) break
    if (el.localName === 'tab') {
      el.parentNode.removeChild(el)
      remaining -= 1
    } else {
      const length = el.textContent.length
      el.textContent = el.textContent.slice(remaining)
      remaining -= length
    }
  }
  return true
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
      const props = readParagraphProps(node, ctx.styles)
      // A heading stays a heading even when Word numbers it through a list: the number
      // belongs to the heading, which the editor draws itself, not to a list wrapped around
      // it. A typed number has to come off BEFORE the runs are rendered.
      const headingNumbered = props.headingLevel
        ? Boolean(props.numId) || stripLeadingNumber(node)
        : false
      // What every run in this paragraph starts from: the document defaults, then the
      // paragraph's style (or the default paragraph style when it names none).
      ctx.paragraphRunProps = {
        ...(ctx.docDefaultRunProps || {}),
        ...(ctx.styles
          ? styleRunProps(ctx.styles, props.styleId || ctx.defaultParagraphStyle, ctx.themeFonts)
          : {}),
      }
      const inner = paragraphInlineHtml(node, ctx)

      if (props.numId && !props.headingLevel) {
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
        // Explicit either way: a heading without the attribute falls back to the editor's
        // original default (H2/H3 numbered, H1 not), which is not what this document says.
        html += `<h${props.headingLevel} data-numbered="${headingNumbered}">${inner}</h${props.headingLevel}>`
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
/**
 * Relationship id → data URI for every picture the body can reference. Resolved through
 * word/_rels/document.xml.rels, the same indirection Word uses, so a logo survives the
 * .docx → editor round trip instead of being dropped on the floor.
 */
async function loadImages(zip, warnings) {
  const images = new Map()
  const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string')
  if (!relsXml) return images
  const rels = new DOMParser().parseFromString(relsXml, 'application/xml')
  const entries = Array.from(rels.getElementsByTagNameNS(REL_NS, 'Relationship'))
  await Promise.all(
    entries.map(async (rel) => {
      if (!/\/image$/.test(rel.getAttribute('Type') || '')) return
      const id = rel.getAttribute('Id')
      const target = (rel.getAttribute('Target') || '').replace(/^\//, '')
      const path = target.startsWith('word/') ? target : `word/${target.replace(/^\.\.\//, '')}`
      const ext = (path.split('.').pop() || '').toLowerCase()
      const mime = IMAGE_MIME[ext]
      if (!mime) {
        warnings.push(`Image ${path.split('/').pop()} was skipped (${ext.toUpperCase()} is not supported).`)
        return
      }
      const base64 = await zip.file(path)?.async('base64')
      if (base64) images.set(id, `data:${mime};base64,${base64}`)
    }),
  )
  return images
}

export async function importDocxToHtml(file, { trackedChanges = false } = {}) {
  const warnings = []
  const zip = await JSZip.loadAsync(await file.arrayBuffer())

  const documentXml = await zip.file('word/document.xml')?.async('string')
  if (!documentXml) {
    throw new Error('Not a valid .docx file (missing word/document.xml).')
  }
  const numberingXml = await zip.file('word/numbering.xml')?.async('string')
  const stylesXml = await zip.file('word/styles.xml')?.async('string')
  const stylesPart = buildStyleLookup(stylesXml)
  const themeFonts = buildThemeFonts(await zip.file('word/theme/theme1.xml')?.async('string'))
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
    styles: stylesPart.styles,
    defaultParagraphStyle: stylesPart.defaultParagraphStyle,
    docDefaultRunProps: readRunProps(stylesPart.defaultRunPr, themeFonts),
    themeFonts,
    tracked: Boolean(trackedChanges),
    comments: buildCommentsLookup(commentsXml),
    images: await loadImages(zip, warnings),
    warnings,
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
  // `getAttributeNS` returns null for an absent attribute, and `Number(null)` is 0 — which
  // is finite. Reading the value straight through `Number()` therefore turned every MISSING
  // margin into a hard 0 mm instead of leaving it unset, so the layout panel showed a
  // confident "0" the source document never stated. Check for the absent value first.
  const num = (node, name) => {
    if (!node) return null
    const raw = wAttr(node, name)
    if (raw == null || raw === '') return null
    const v = Number(raw)
    return Number.isFinite(v) ? v : null
  }

  // Truthiness would also drop a legitimate 0, and `w && h` discarded BOTH dimensions when
  // only one was present. Compare against null explicitly.
  const w = num(pgSz, 'w')
  const h = num(pgSz, 'h')
  const size = w != null && h != null ? { width: w, height: h } : null

  // Only keys the document actually declares: the consumers merge this over the A4
  // defaults, so an omitted key must stay omitted to inherit rather than force a zero.
  const margins = pgMar
    ? Object.fromEntries(
        ['top', 'right', 'bottom', 'left']
          .map((side) => [side, num(pgMar, side)])
          .filter(([, value]) => value != null),
      )
    : null
  const hasMargins = margins && Object.keys(margins).length > 0

  if (!size && !hasMargins) return null
  return { size, margins: hasMargins ? margins : null }
}
