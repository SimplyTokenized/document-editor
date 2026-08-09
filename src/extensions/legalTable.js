/**
 * Table node extended with per-table sizing, so each table on the page can be resized
 * independently of any other table — the author sizes whichever table the cursor is in.
 *
 * Table WIDTH is enforced by rescaling the underlying column pixel widths (the `colwidth`
 * attribute TipTap's table already stores per cell) rather than a CSS `width` property.
 * @tiptap/extension-table's table node view (`TableView`) draws its own `<table>` DOM and
 * recomputes `table.style.width` from those column widths on every transaction — an inline
 * style that always wins over any external stylesheet rule, so a CSS-only width never takes
 * visible effect. Rescaling `colwidth` is the exact mechanism a manual drag-resize uses, so
 * it's respected by the node view natively, and for free by the .docx/PDF export (which
 * already reads `colwidth` per cell — see docxExport.js). `tableWidthPct` itself is stored
 * only as a display value for the table-size popover; it does not drive any CSS.
 *
 * Cell padding and row height ARE effective as plain CSS: th/td have no custom node view, so
 * attribute-derived styling applies to them normally. They're controlled from the TABLE node
 * (so one popover sizes the whole table) as CSS custom properties the cells read through
 * inheritance. TableView only copies its constructor's HTMLAttributes into the table DOM's
 * style ONCE, at construction — its update() method only ever touches `width`/`min-width` —
 * so a later edit needs a decoration (which IS reapplied on every state change) to actually
 * reach the screen; renderHTML alone would only ever show a value from when the table first
 * mounted.
 */
import { Table } from '@tiptap/extension-table'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// Matches @tiptap/extension-table's own `cellMinWidth` option default — the width a column
// is assumed to have when it's never been explicitly resized.
const DEFAULT_CELL_MIN_WIDTH = 25

// 96 CSS px per inch, 25.4 mm per inch — consistent with PageLayoutPanel's conversion.
const PX_PER_MM = 96 / 25.4
const mmToPx = (mm) => Math.round(mm * PX_PER_MM * 100) / 100

// A plain numeric attribute persisted as a `data-*` HTML attribute — never `style` — so it
// never competes with @tiptap/extension-table's own width/min-width style computation for
// the table's `style="width:…"` (see Table's renderHTML: it treats ANY existing `style`
// contributed by another attribute as a user override and drops its own width entirely).
const dataNumberAttribute = (key, dataAttr) => ({
  default: null,
  parseHTML: (element) => {
    const raw = element.getAttribute(dataAttr)
    const n = raw === null ? NaN : parseFloat(raw)
    return Number.isFinite(n) ? n : null
  },
  renderHTML: (attributes) => {
    const value = attributes[key]
    if (value === null || value === undefined || value === '') return {}
    return { [dataAttr]: String(value) }
  },
})

// A millimetre-valued attribute rendered both as a lossless `data-*` (for round-tripping
// through saved HTML) and as a CSS custom property in px (for the stylesheet + initial
// table-mount styling). Storing the mm value itself — not a derived px value — means the
// number shown in the popover is always exactly what was typed, with no rounding drift from
// repeated mm→px→mm conversions on every keystroke.
const mmCssVarAttribute = (key, dataAttr, cssProp) => ({
  default: null,
  parseHTML: (element) => {
    const raw = element.getAttribute(dataAttr)
    const n = raw === null ? NaN : parseFloat(raw)
    if (Number.isFinite(n)) return n
    // Fall back to reading the rendered CSS var back out (px→mm) for HTML that predates the
    // data-* attribute, or was hand-edited.
    const varRaw = element.style?.getPropertyValue(cssProp)?.trim()
    const px = varRaw ? parseFloat(varRaw) : NaN
    return Number.isFinite(px) ? Math.round((px / PX_PER_MM) * 10) / 10 : null
  },
  renderHTML: (attributes) => {
    const mm = attributes[key]
    if (mm === null || mm === undefined || mm === '') return {}
    return { [dataAttr]: String(mm), style: `${cssProp}: ${mmToPx(mm)}px` }
  },
})

// Live CSS for the decoration — mirrors mmCssVarAttribute's renderHTML so the on-screen
// value always matches what would be serialized. Width is intentionally NOT here: see the
// module doc comment for why a CSS width can never take effect against TableView.
const layoutDecorationStyle = (attrs) => {
  const parts = []
  if (Number.isFinite(attrs?.cellPadY))
    parts.push(`--legal-doc-cell-pad-y: ${mmToPx(attrs.cellPadY)}px`)
  if (Number.isFinite(attrs?.cellPadX))
    parts.push(`--legal-doc-cell-pad-x: ${mmToPx(attrs.cellPadX)}px`)
  if (attrs?.rowMinH) parts.push(`--legal-doc-cell-min-h: ${mmToPx(attrs.rowMinH)}px`)
  return parts.join('; ')
}

const layoutDecorationsKey = new PluginKey('legalTableLayoutDecorations')

/**
 * Rescale per-cell `colwidth` so the table's rendered width matches `widthPct` of the
 * editor's printable content width.
 *
 * EVERY cell in EVERY row is rewritten, and that is the load-bearing part, not thoroughness:
 * prosemirror-tables runs a `fixTables` normalizer after each transaction (no meta skips
 * it), and when cells in the same column disagree about their colwidth it rewrites the
 * minority back to the column's established width. A drag-resize updates the whole column,
 * so it survives; the previous version of this function rewrote only the first row, and on
 * a .docx-imported table — where the importer stamps colwidth on every cell of every row —
 * the untouched rows outvoted row 1 and the normalizer reverted the change synchronously,
 * inside the same dispatch. The width control read as simply dead.
 *
 * Attribute-only changes (setNodeMarkup) never resize the document, so every position
 * computed from the pre-transaction node stays valid across all the writes.
 *
 * Known limit: the column cursor counts colspans only. A cell spanning DOWN from an earlier
 * row (rowspan) would shift later rows' columns; the legal-sheet tables this editor handles
 * do not use rowspan.
 */
const rescaleTableColumns = (
  tr,
  tablePos,
  tableNode,
  widthPct,
  view,
  printableWidthPx = null,
  onlyOverflowing = false,
) => {
  if (!(widthPct > 0)) return
  // Prefer an explicit printable width over measuring the DOM: during a page-setup change
  // the new margins reach the DOM as CSS variables on React's schedule, and a measurement
  // taken in the same tick (or even the next frame) can still see the OLD geometry — the
  // refit then computes the old width and visibly does nothing. The caller that changes the
  // page KNOWS the new geometry; only interactive per-table sizing falls back to measuring.
  let innerWidth = printableWidthPx
  if (!(innerWidth > 0)) {
    if (!view?.dom) return
    const proseEl = view.dom
    const cs = window.getComputedStyle(proseEl)
    innerWidth =
      proseEl.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0')
  }
  if (!(innerWidth > 0)) return
  const targetPx = Math.max(50, Math.round((innerWidth * widthPct) / 100))

  const rows = []
  tableNode.forEach((row, offset) => rows.push({ row, offset }))
  if (!rows.length) return

  // Grid shape: column count is the widest row measured in colspans, and each column's
  // current width is the first defined value found for it in any row — a spanning banner
  // row alone says nothing about where the internal boundaries fall.
  let colCount = 0
  rows.forEach(({ row }) => {
    let n = 0
    row.forEach((cell) => {
      n += cell.attrs.colspan || 1
    })
    colCount = Math.max(colCount, n)
  })
  if (!colCount) return

  const currentWidths = new Array(colCount).fill(0)
  rows.forEach(({ row }) => {
    let col = 0
    row.forEach((cell) => {
      const span = cell.attrs.colspan || 1
      const colwidth = cell.attrs.colwidth
      for (let i = 0; i < span && col + i < colCount; i += 1) {
        if (colwidth && colwidth[i] && !currentWidths[col + i]) {
          currentWidths[col + i] = colwidth[i]
        }
      }
      col += span
    })
  })
  for (let i = 0; i < colCount; i += 1) {
    if (!currentWidths[i]) currentWidths[i] = DEFAULT_CELL_MIN_WIDTH
  }

  const currentTotal = currentWidths.reduce((sum, w) => sum + w, 0)
  if (!(currentTotal > 0)) return
  // Clamp mode: leave any table that already fits alone. Used by the on-load pass, whose
  // job is only to repair impossible states (a table wider than the paper's content box,
  // which CSS cannot cap — a fixed-layout table's colgroup beats max-width), never to
  // second-guess widths an import or an author chose deliberately.
  if (onlyOverflowing && currentTotal <= innerWidth + 1) return
  const ratio = targetPx / currentTotal
  const nextWidths = currentWidths.map((w) => Math.max(10, Math.round(w * ratio)))

  rows.forEach(({ row, offset }) => {
    const rowStart = tablePos + 1 + offset
    let pos = rowStart + 1
    let col = 0
    row.forEach((cell) => {
      const span = cell.attrs.colspan || 1
      const slice = nextWidths.slice(col, col + span)
      tr.setNodeMarkup(pos, undefined, { ...cell.attrs, colwidth: slice })
      col += span
      pos += cell.nodeSize
    })
  })
}

/**
 * Re-fit every table in the document to the CURRENT printable width.
 *
 * Column widths are absolute pixels, captured when the table was authored or imported, so
 * they do not follow the page: widening the printable area (smaller margins, larger paper)
 * left a table stranded at its old width with a growing white strip down one side, and the
 * .docx/PDF exports inherited the same stranded numbers.
 *
 * A table that carries an explicit `tableWidthPct` keeps it — that is a deliberate choice
 * from the Table size control. Everything else is fitted to the full width, which is what a
 * page-geometry change implies.
 *
 * One transaction for the whole document, and attribute-only (`setNodeMarkup`) so no
 * position shifts mid-walk. Tagged `skipTrackChanges` because re-fitting is layout
 * bookkeeping, not an authored edit — it must never show up as a redline.
 */
export const refitTablesToPrintableWidth = (editor, pageSetup = null, { onlyOverflowing = false } = {}) => {
  if (!editor || editor.isDestroyed) return false
  // Printable width straight from the page geometry (twips), not from the DOM: 1 inch is
  // 1440 twips and 96 CSS px, so px = twips / 15. Passing the just-chosen pageSetup makes
  // the refit immune to when React gets around to painting the new margins.
  let printableWidthPx = null
  if (pageSetup?.size || pageSetup?.margins) {
    const w = pageSetup?.size?.width ?? 11906
    const left = pageSetup?.margins?.left ?? 1134
    const right = pageSetup?.margins?.right ?? 1134
    const twips = w - left - right
    if (twips > 0) printableWidthPx = Math.round(twips / 15)
  }
  const { state, view } = editor
  const tables = []
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'table') {
      tables.push({ node, pos })
      return false // never recurse into a nested table: its parent cell governs its width
    }
    return true
  })
  if (!tables.length) return false

  const tr = state.tr
  tables.forEach(({ node, pos }) => {
    const pct = node.attrs?.tableWidthPct
    rescaleTableColumns(tr, pos, node, pct > 0 ? pct : 100, view, printableWidthPx, onlyOverflowing)

    // Nested tables are governed by the CELL they sit in, not by the page — but they carry
    // fixed pixel columns just like their parent, so once the parent's columns change (or
    // were saved out of sync) a nested table can be wider than its cell and run straight off
    // the paper, where no CSS can stop it. Clamp each one to its cell's fresh width. Always
    // clamp-only: a nested table narrower than its cell is a layout choice, never repaired.
    //
    // Every change so far is attribute-only (setNodeMarkup), so positions computed from the
    // pre-transaction tree stay valid, and tr.doc already shows the parent's new widths.
    const fresh = tr.doc.nodeAt(pos)
    if (!fresh) return
    fresh.forEach((row, rowOffset) => {
      if (row.type.name !== 'tableRow') return
      let cellPos = pos + 1 + rowOffset + 1
      row.forEach((cell) => {
        const cellWidth = (cell.attrs.colwidth || []).reduce((sum, w) => sum + (w || 0), 0)
        if (cellWidth > 0) {
          cell.forEach((child, childOffset) => {
            if (child.type.name === 'table') {
              rescaleTableColumns(
                tr,
                cellPos + 1 + childOffset,
                child,
                100,
                view,
                Math.max(60, cellWidth - 12), // minus the cell's own horizontal padding
                true,
              )
            }
          })
        }
        cellPos += cell.nodeSize
      })
    })
  })
  if (!tr.docChanged) return false
  tr.setMeta('skipTrackChanges', true)
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
  return true
}

export const LegalTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tableWidthPct: dataNumberAttribute('tableWidthPct', 'data-legal-table-width-pct'),
      cellPadY: mmCssVarAttribute('cellPadY', 'data-legal-cell-pad-y', '--legal-doc-cell-pad-y'),
      cellPadX: mmCssVarAttribute('cellPadX', 'data-legal-cell-pad-x', '--legal-doc-cell-pad-x'),
      rowMinH: mmCssVarAttribute('rowMinH', 'data-legal-row-min-h', '--legal-doc-cell-min-h'),
    }
  },

  addCommands() {
    return {
      ...this.parent?.(),
      // Merge the given layout attributes into the table that contains the current
      // selection, and — if a new width was given — physically rescale its columns to match.
      // Deliberately does NOT move focus, so it can be driven from a popover's form fields
      // without yanking the caret back into the document on every keystroke.
      setLegalTableLayout:
        (attrs) =>
        ({ state, tr, dispatch, view }) => {
          const { $from } = state.selection
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            const node = $from.node(depth)
            if (node.type.name !== this.name) continue
            if (dispatch) {
              const tablePos = $from.before(depth)
              tr.setNodeMarkup(tablePos, undefined, { ...node.attrs, ...attrs })
              if (
                Object.prototype.hasOwnProperty.call(attrs, 'tableWidthPct') &&
                attrs.tableWidthPct != null
              ) {
                rescaleTableColumns(tr, tablePos, node, attrs.tableWidthPct, view)
              }
              dispatch(tr)
            }
            return true
          }
          return false
        },
    }
  },

  addProseMirrorPlugins() {
    const parentPlugins = this.parent?.() ?? []
    const typeName = this.name
    const layoutPlugin = new Plugin({
      key: layoutDecorationsKey,
      props: {
        decorations: (state) => {
          const decorations = []
          state.doc.descendants((node, pos) => {
            if (node.type.name !== typeName) return
            const style = layoutDecorationStyle(node.attrs)
            if (style) decorations.push(Decoration.node(pos, pos + node.nodeSize, { style }))
          })
          return decorations.length ? DecorationSet.create(state.doc, decorations) : null
        },
      },
    })
    return [...parentPlugins, layoutPlugin]
  },
})

export default LegalTable
