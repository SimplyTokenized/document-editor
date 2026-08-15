import { Node, mergeAttributes } from '@tiptap/core'

/**
 * A block emitted once per selected answer.
 *
 * Sibling of `conditionalText`, and the same trade in stored markup: the
 * wrapper MUST survive into the saved HTML, because the backend is what decides
 * how many copies a given tenant's document gets. Unlike `tokenHighlight`, this
 * is not a view-only decoration.
 *
 * A NODE rather than a mark, for a structural reason. A mark describes a range
 * of inline text and has no body to duplicate; this wraps block content that
 * gets copied whole. That is also why it cannot be expressed with
 * `conditionalText`, which only ever decides whether a passage appears — never
 * how many times.
 *
 * The bound question is an OPAQUE string here. This package knows nothing about
 * interviews, answers or options, exactly as it knows nothing about what a
 * merge field means; the host writes the key and the host (and backend) resolve
 * it.
 */

export const REPEAT_BLOCK_ATTR = 'data-interview-repeat'

export const RepeatBlock = Node.create({
  name: 'repeatBlock',

  group: 'block',

  // Block content, plural: the point is to repeat a passage, which is usually
  // a heading and a paragraph rather than a single line.
  content: 'block+',

  // Its own boundary — typing at the end of the last paragraph must not escape
  // the block, or an author silently writes outside the thing they are
  // repeating.
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      factKey: {
        default: null,
        parseHTML: (element) => element.getAttribute(REPEAT_BLOCK_ATTR),
        renderHTML: (attributes) => {
          if (!attributes.factKey) return {}
          return { [REPEAT_BLOCK_ATTR]: attributes.factKey }
        },
      },
      /** Plain-language summary ("once per: which recipients…"), shown as the
       *  hover title so the rule is readable in the document itself. */
      note: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-interview-note'),
        renderHTML: (attributes) => {
          if (!attributes.note) return {}
          return { 'data-interview-note': attributes.note, title: attributes.note }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: `div[${REPEAT_BLOCK_ATTR}]` }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: 'legal-repeat' }), 0]
  },

  addCommands() {
    return {
      /**
       * Wraps the current selection in a repeat block.
       * @param {{factKey: string, note?: string}} attributes
       */
      setRepeatBlock:
        (attributes) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attributes),

      /** Unwraps it, keeping the content — the author decided it does not
       *  repeat after all, and losing the wording to that would be absurd. */
      unsetRepeatBlock:
        () =>
        ({ commands }) =>
          commands.lift(this.name),

      /** Rebinds an existing block to a different question. */
      updateRepeatBlock:
        (attributes) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, attributes),
    }
  },
})

export default RepeatBlock
