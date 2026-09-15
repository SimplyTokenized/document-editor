/**
 * Table cell / header extended with a `backgroundColor` attribute so Word cell shading
 * (w:shd fill) survives import → edit → export. The stock TipTap TableCell has no shading
 * concept; this adds one that parses from the cell's inline `background-color` (or a
 * `data-background-color` fallback) and renders it back out on getHTML() — which the docx
 * export then reads to re-apply w:shd.
 */
import { TableCell, TableHeader } from '@tiptap/extension-table'
import { dataFlagAttribute } from './legalTable.js'

const backgroundColorAttribute = {
  backgroundColor: {
    default: null,
    parseHTML: (element) =>
      element.style?.backgroundColor || element.getAttribute('data-background-color') || null,
    renderHTML: (attributes) => {
      if (!attributes.backgroundColor) return {}
      return {
        style: `background-color: ${attributes.backgroundColor}`,
        'data-background-color': attributes.backgroundColor,
      }
    },
  },
}

// Per-cell counterpart of the table's `borderless` flag: a form keeps its boxed fields
// while the label column beside them draws no lines.
const borderlessAttribute = { borderless: dataFlagAttribute('borderless', 'data-legal-borderless') }

export const LegalTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...backgroundColorAttribute,
      ...borderlessAttribute,
    }
  },
})

export const LegalTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...backgroundColorAttribute,
      ...borderlessAttribute,
    }
  },
})
