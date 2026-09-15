import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  HEADING_NUMBERED_ATTR,
  computeHeadingNumbers,
  headingNumberStyleCss,
  isHeadingNumbered,
  mergeCommonTextStyle,
  parseHeadingNumbered,
} from './headingNumbers.js'

/**
 * Word-style heading numbering, switchable per heading.
 *
 * The CHOICE is stored — `data-numbered="true|false"` on the heading — and the NUMBER is not.
 * The number is a decoration (`data-heading-number`, drawn by a ::before rule), so adding,
 * removing or moving a section renumbers everything after it and the saved HTML never
 * carries a stale "4.2". The exports compute the same labels with the same function.
 *
 * This replaced CSS counters, which can neither skip an unnumbered heading without counting
 * it nor pick the top level from what the document actually numbers: an imported prospectus
 * that numbers its H1s came out as "57. 12.1 Historical Financial Information".
 */
const headingNumberingKey = new PluginKey('headingNumbering')

/** Font, size and colour every character of the heading shares (its textStyle marks). */
const headingTextStyle = (heading) => {
  let common = null
  heading.descendants((child) => {
    if (!child.isText || !child.text.trim()) return
    const attrs = child.marks.find((mark) => mark.type.name === 'textStyle')?.attrs || {}
    common = mergeCommonTextStyle(common, attrs)
  })
  return common || {}
}

const buildDecorations = (doc) => {
  const headings = []
  doc.descendants((node, position) => {
    if (node.type.name !== 'heading') return true
    headings.push({ node, position })
    return false
  })
  const labels = computeHeadingNumbers(
    headings.map(({ node }) => ({ level: node.attrs.level, numbered: node.attrs.numbered })),
  )
  return DecorationSet.create(
    doc,
    headings.flatMap(({ node, position }, i) => {
      if (!labels[i]) return []
      // The number wears the line's font/size/colour when the whole line shares one.
      const style = headingNumberStyleCss(headingTextStyle(node))
      return [
        Decoration.node(position, position + node.nodeSize, {
          'data-heading-number': labels[i],
          ...(style ? { style } : {}),
        }),
      ]
    }),
  )
}

export const HeadingNumbering = Extension.create({
  name: 'headingNumbering',

  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          numbered: {
            default: null,
            parseHTML: (element) => parseHeadingNumbered(element.getAttribute(HEADING_NUMBERED_ATTR)),
            renderHTML: (attributes) =>
              attributes.numbered == null ? {} : { [HEADING_NUMBERED_ATTR]: String(attributes.numbered) },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      /** Number the heading the selection is in, or stop numbering it. */
      toggleHeadingNumbering:
        () =>
        ({ commands, editor }) => {
          if (!editor.isActive('heading')) return false
          const { level, numbered } = editor.getAttributes('heading')
          return commands.updateAttributes('heading', { numbered: !isHeadingNumbered(level, numbered) })
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: headingNumberingKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc),
          // Any edit can shift every later number, so rebuild on doc changes; a selection
          // move maps nothing and keeps the set.
          apply: (transaction, previous) =>
            transaction.docChanged ? buildDecorations(transaction.doc) : previous,
        },
        props: {
          decorations(state) {
            return headingNumberingKey.getState(state)
          },
        },
      }),
    ]
  },
})

export default HeadingNumbering
