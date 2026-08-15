import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * Types-ahead completion for `{{` merge fields.
 *
 * The toolbar menu is fine for browsing a catalog you don't know; it is the
 * wrong tool once you do, because it takes your hands off the text and drops
 * the token wherever the cursor last was. An author writing "zahlbar durch
 * {{" wants the list right there, filtered by what they keep typing.
 *
 * DETECTION HERE, RENDERING IN THE HOST — the same split as `insertExtras`.
 * This plugin knows where the cursor is and what has been typed since `{{`; it
 * knows nothing about what placeholders exist, which entity they read, or how
 * the host wants a popup to look. It reports state and offers a command; the
 * host draws the menu and decides what goes in it.
 *
 * No `@tiptap/suggestion` dependency: that package is not installed here, and
 * the part of it we need is a few lines of cursor inspection. `tokenHighlight`
 * is hand-written for the same reason.
 */

export const placeholderSuggestionKey = new PluginKey('placeholderSuggestion')

/** Matches `{{` plus whatever has been typed after it, anchored at the cursor.
 *  Stops at whitespace or a closing brace so an already-finished token on the
 *  same line cannot re-trigger the menu. */
const TRIGGER = /\{\{([a-zA-Z0-9_.:]*)$/

/** Reads the text of the current block up to the cursor. */
const textBeforeCursor = (state) => {
  const { $from, empty } = state.selection
  if (!empty) return null
  return $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
}

export const PlaceholderSuggestion = Extension.create({
  name: 'placeholderSuggestion',

  addOptions() {
    return {
      /**
       * Called whenever the trigger state changes.
       * @type {(state: {active: boolean, query: string, range: {from: number, to: number} | null, rect: DOMRect | null}) => void}
       */
      onStateChange: null,
      /**
       * Given to the host so it can drive selection from its own popup.
       * @type {(event: KeyboardEvent) => boolean}
       */
      onKeyDown: null,
    }
  },

  addCommands() {
    return {
      /**
       * Replaces the in-progress `{{…` with a complete token.
       * @param {{from: number, to: number}} range
       * @param {string} code the full token, e.g. `{{offering.asset_name}}`
       */
      completePlaceholder:
        (range, code) =>
        ({ chain }) =>
          chain().focus().insertContentAt(range, code).run(),
    }
  },

  addProseMirrorPlugins() {
    const extension = this

    return [
      new Plugin({
        key: placeholderSuggestionKey,

        view() {
          let previous = { active: false, query: '' }

          return {
            update(view) {
              const notify = extension.options.onStateChange
              if (typeof notify !== 'function') return

              const text = textBeforeCursor(view.state)
              const match = text === null ? null : TRIGGER.exec(text)

              if (!match) {
                if (previous.active) {
                  previous = { active: false, query: '' }
                  notify({ active: false, query: '', range: null, rect: null })
                }
                return
              }

              const query = match[1] ?? ''
              if (previous.active && previous.query === query) return
              previous = { active: true, query }

              const to = view.state.selection.from
              const from = to - match[0].length

              let rect = null
              try {
                const start = view.coordsAtPos(from)
                rect = { top: start.top, bottom: start.bottom, left: start.left, right: start.right }
              } catch {
                // Position no longer in the document (mid-transaction); the host
                // can fall back to anchoring on the editor itself.
                rect = null
              }

              notify({ active: true, query, range: { from, to }, rect })
            },

            destroy() {
              const notify = extension.options.onStateChange
              if (typeof notify === 'function') notify({ active: false, query: '', range: null, rect: null })
            },
          }
        },

        props: {
          handleKeyDown(view, event) {
            const handler = extension.options.onKeyDown
            if (typeof handler !== 'function') return false
            // The host returns true when its popup consumed the key — arrow
            // navigation and Enter belong to the menu while it is open, not to
            // the document.
            return handler(event) === true
          },
        },
      }),
    ]
  },
})

export default PlaceholderSuggestion
