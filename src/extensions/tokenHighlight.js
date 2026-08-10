import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Renders `{{…}}` tokens as tinted chips while they are being edited.
 *
 * Two kinds, styled differently because they behave differently: a merge field
 * (`{{buyer_name}}`) is a value that drops in when the document is generated, and
 * a signature anchor (`{{sign:client.signature}}`) is a box someone signs. Telling
 * them apart at a glance is the point — an anchor that silently failed to register
 * looks exactly like body text otherwise.
 *
 * DECORATION, NOT A MARK, deliberately. Decorations live in the view and never
 * reach `getHTML()`, so the stored document keeps the bare token text. That
 * matters: the backend finds anchors with a regex
 * (st-backend-v2 `helpers/signing/signatureAnchors.js`) and fills merge fields
 * with another. A mark would wrap tokens in `<span>`s and could split one across
 * text nodes, which is precisely how a document ends up rendering with no
 * signature fields at all. It also leaves .docx and PDF export untouched.
 *
 * The decoration set is rebuilt only when the document actually changes; a
 * selection move in a long contract re-uses the mapped set rather than
 * re-scanning every text node on every keystroke.
 */

/**
 * Mirrors the backend's anchor regex exactly — role is `[a-z0-9_-]+`, type is
 * `[a-z_]+`. A token this does not match is not an anchor to the renderer either,
 * so highlighting it would be a lie.
 */
const SIGNATURE_ANCHOR_PATTERN = /\{\{\s*sign:[a-z0-9_-]+\.[a-z_]+\s*\}\}/gi

/** Anything else in double braces: `{{buyer_name}}`, `{{offering.name}}`. */
const MERGE_FIELD_PATTERN = /\{\{\s*(?!sign:)[a-z0-9_.]+\s*\}\}/gi

const tokenHighlightKey = new PluginKey('tokenHighlight')

/**
 * @param {import('@tiptap/pm/model').Node} doc
 * @returns {DecorationSet}
 */
const buildDecorations = (doc) => {
  const decorations = []

  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return

    // Anchors first: a `{{sign:…}}` token would also satisfy a laxer merge-field
    // read, and it must win. The two patterns are mutually exclusive as written
    // (the merge field excludes the `sign:` prefix), but the order documents the
    // intent for whoever loosens one of them later.
    for (const [pattern, className] of [
      [SIGNATURE_ANCHOR_PATTERN, 'legal-token legal-token--signature'],
      [MERGE_FIELD_PATTERN, 'legal-token legal-token--merge'],
    ]) {
      pattern.lastIndex = 0
      let match = pattern.exec(node.text)
      while (match !== null) {
        decorations.push(
          Decoration.inline(position + match.index, position + match.index + match[0].length, {
            class: className,
          }),
        )
        match = pattern.exec(node.text)
      }
    }
  })

  return DecorationSet.create(doc, decorations)
}

export const TokenHighlight = Extension.create({
  name: 'tokenHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tokenHighlightKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc),
          apply: (transaction, previous) =>
            transaction.docChanged
              ? buildDecorations(transaction.doc)
              : previous.map(transaction.mapping, transaction.doc),
        },
        props: {
          decorations(state) {
            return tokenHighlightKey.getState(state)
          },
        },
      }),
    ]
  },
})

export default TokenHighlight
