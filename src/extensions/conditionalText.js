import { Mark, mergeAttributes } from '@tiptap/core'

/**
 * Marks a passage as conditional: it lands in the generated document only when
 * the condition it carries holds for that run.
 *
 * Section slots already make a whole clause conditional. This is the
 * phrase-level version, and it exists to kill the "variant module" pattern —
 * two near-identical clauses differing by one sentence, which doubles a template
 * every time a lawyer writes "…, unless the client is a consumer".
 *
 * A MARK, NOT A DECORATION — the opposite choice from `tokenHighlight.js`, and
 * for the opposite reason. Tokens are decorations precisely so they never reach
 * `getHTML()`, because the backend finds them by regex in the stored text. A
 * conditional span MUST reach the stored HTML, because the backend is what
 * decides whether the text inside belongs in this tenant's document. Two
 * consequences the host has to honour:
 *
 *   • .docx / PDF export must unwrap these spans — authoring markup has no
 *     business in a delivered file. (`stripConditionalSpans` in the host.)
 *   • A `{{…}}` token must never straddle a span boundary: `{{buyer` inside and
 *     `.name}}` outside stops the backend regex matching, silently, and only
 *     visibly at generation time. The host lints for this.
 *
 * The condition itself is opaque here — a JSON string the host writes and the
 * host (and backend) evaluate. This package stays free of any knowledge of what
 * a condition means, exactly as it does for merge fields.
 */
export const CONDITIONAL_TEXT_ATTR = 'data-interview-condition'

export const ConditionalText = Mark.create({
  name: 'conditionalText',

  // Conditional passages nest — "for consumers, [in Austria] …" — and each level
  // is evaluated independently.
  inclusive: false,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      condition: {
        default: null,
        parseHTML: (element) => element.getAttribute(CONDITIONAL_TEXT_ATTR),
        renderHTML: (attributes) => {
          if (!attributes.condition) return {}
          return { [CONDITIONAL_TEXT_ATTR]: attributes.condition }
        },
      },
      /** Plain-language summary, rendered as the hover title so an author can
       *  read the rule without opening the editor panel. */
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
    return [{ tag: `span[${CONDITIONAL_TEXT_ATTR}]` }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: 'legal-conditional' }), 0]
  },

  addCommands() {
    return {
      /** @param {{ condition: string, note?: string }} attrs */
      setConditionalText:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetConditionalText:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      /** @param {{ condition: string, note?: string }} attrs */
      toggleConditionalText:
        (attrs) =>
        ({ commands }) =>
          commands.toggleMark(this.name, attrs),
    }
  },
})

export default ConditionalText
