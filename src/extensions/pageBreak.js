/**
 * "Start a new page here" as a real attribute on paragraphs and headings.
 *
 * Without it a page break could only be smuggled in as `style="page-break-before: always"`
 * on a <p> — which the backend PDF renderer honours, but which TipTap drops the moment the
 * document is re-serialised, because `style` is not an attribute the paragraph node knows.
 * A template saved once from the editor silently lost every page break.
 *
 * Stored twice on purpose: `data-page-break-before` for the editor, the print CSS and the
 * .docx export to key off, AND the CSS declaration itself, which is what the backend renderer
 * already reads (`htmlToPdfRenderer.js`, "page-break-before/after: always") — so one attribute
 * paginates every output the same way.
 */
import { Extension } from '@tiptap/core'

const ATTR = 'data-page-break-before'

export const PageBreak = Extension.create({
  name: 'pageBreak',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          pageBreakBefore: {
            default: false,
            parseHTML: (element) =>
              element.hasAttribute(ATTR) ||
              /always/i.test(element.style?.pageBreakBefore || element.style?.breakBefore || ''),
            renderHTML: (attributes) =>
              attributes.pageBreakBefore ? { [ATTR]: '1', style: 'page-break-before: always' } : {},
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      /** Toggle a page break before the block the selection is in. */
      togglePageBreakBefore:
        () =>
        ({ commands, editor }) => {
          const type = editor.isActive('heading') ? 'heading' : 'paragraph'
          const current = Boolean(editor.getAttributes(type).pageBreakBefore)
          return commands.updateAttributes(type, { pageBreakBefore: !current })
        },
      /**
       * Word's "insert page break": whatever follows the cursor starts a new page. Mid-
       * paragraph, the paragraph is split first and the second half carries the break; at
       * the start of a block, the block itself does.
       */
      insertPageBreak:
        () =>
        ({ tr, commands }) => {
          const { $from, empty } = tr.selection
          if (!empty || $from.parentOffset > 0) commands.splitBlock()
          const type = tr.selection.$from.parent.type.name
          if (type !== 'paragraph' && type !== 'heading') return false
          return commands.updateAttributes(type, { pageBreakBefore: true })
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.insertPageBreak(),
    }
  },
})
