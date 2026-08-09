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

// Rescale the first row's per-cell `colwidth` (the data TableView reads to build the table's
// colgroup — see updateColumns in @tiptap/extension-table) so the table's actual rendered
// width matches `widthPct` of the editor's printable content width. This is the same
// mechanism a manual drag-resize uses, so it's honoured by the node view for free.
const rescaleTableColumns = (tr, tablePos, tableNode, widthPct, view) => {
  if (!(widthPct > 0) || !view?.dom) return
  const proseEl = view.dom
  const cs = window.getComputedStyle(proseEl)
  const innerWidth =
    proseEl.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0')
  if (!(innerWidth > 0)) return
  const targetPx = Math.max(50, Math.round((innerWidth * widthPct) / 100))

  const firstRow = tableNode.firstChild
  if (!firstRow) return

  const currentWidths = []
  firstRow.forEach((cell) => {
    const colspan = cell.attrs.colspan || 1
    const colwidth = cell.attrs.colwidth
    for (let i = 0; i < colspan; i += 1) {
      currentWidths.push((colwidth && colwidth[i]) || DEFAULT_CELL_MIN_WIDTH)
    }
  })
  const currentTotal = currentWidths.reduce((sum, w) => sum + w, 0)
  if (!(currentTotal > 0)) return
  const ratio = targetPx / currentTotal
  const nextWidths = currentWidths.map((w) => Math.max(10, Math.round(w * ratio)))

  // tablePos → table's own start token; +1 steps into the table (start of the first row);
  // +1 again steps into that row (start of its first cell) — standard ProseMirror position
  // arithmetic for "first child of the first child". Attribute-only changes (setNodeMarkup)
  // never resize the document, so these positions, all computed from the pre-transaction
  // node, stay valid across every call in this same transaction.
  let pos = tablePos + 2
  let colCursor = 0
  firstRow.forEach((cell) => {
    const colspan = cell.attrs.colspan || 1
    const slice = nextWidths.slice(colCursor, colCursor + colspan)
    tr.setNodeMarkup(pos, undefined, { ...cell.attrs, colwidth: slice })
    colCursor += colspan
    pos += cell.nodeSize
  })
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
