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

/** `{{ offering.name }}` and `{{offering.name}}` are the same token; the host's
 *  list is written in the canonical form, so compare in it. */
const normalizeToken = (token) => token.replace(/\s+/g, '').toLowerCase()

/**
 * @param {import('@tiptap/pm/model').Node} doc
 * @param {Set<string> | null} known merge-field codes the host recognises, or
 *   null when the host supplies no list — in which case nothing is marked
 *   unknown, because "we don't know" must not render as "this is wrong".
 * @returns {DecorationSet}
 */
const buildDecorations = (doc, known) => {
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
        // A merge field the host does not recognise is almost always a typo,
        // and it fails silently: at generation time it is substituted with
        // nothing, so the contract reads as a finished sentence with a word
        // missing. Marking it here is the only moment anyone can catch it.
        // Anchors are never checked against the list — their roles are bound
        // later, by whichever flow sends the envelope, so this file cannot know
        // which are valid.
        const isMergeField = className.endsWith('--merge')
        const unknown = isMergeField && known !== null && !known.has(normalizeToken(match[0]))

        decorations.push(
          Decoration.inline(position + match.index, position + match.index + match[0].length, {
            class: unknown ? `${className} legal-token--unknown` : className,
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

  addOptions() {
    return {
      /**
       * Every merge field the host recognises, canonical form
       * (`['{{offering.asset_name}}', '{{wizard.country}}', …]`). Anything else
       * renders as unknown. Leave null — the default — and no token is ever
       * marked unknown: a host that has not told us what exists must not have
       * its authors' correct tokens flagged as mistakes.
       *
       * The list is read at editor creation and on `setKnownTokens`, not on
       * every render, so passing a fresh array each render is harmless.
       * @type {string[] | null}
       */
      knownTokens: null,
    }
  },

  addCommands() {
    return {
      /**
       * Replaces the known-token list and re-renders. Needed because the list
       * grows while the author works — every question they write adds a
       * `{{wizard.<factKey>}}` — and extensions are configured only once.
       * @param {string[] | null} tokens
       */
      setKnownTokens:
        (tokens) =>
        ({ tr }) => {
          // Mutate the command's own `tr` rather than dispatching a fresh one:
          // TipTap's CommandManager dispatches `tr` itself right after this
          // returns. Dispatching a second transaction here meant that whenever a
          // plugin appended a doc change to it (the trailing paragraph added to
          // a document that ends with a table, for one), the manager's `tr` was
          // already stale — "Applying a mismatched transaction", blank editor.
          tr.setMeta(tokenHighlightKey, { knownTokens: tokens })
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const extension = this
    const toSet = (tokens) => (Array.isArray(tokens) ? new Set(tokens.map(normalizeToken)) : null)

    return [
      new Plugin({
        key: tokenHighlightKey,
        state: {
          init: (_config, state) => {
            const known = toSet(extension.options.knownTokens)
            return { known, decorations: buildDecorations(state.doc, known) }
          },
          apply: (transaction, previous) => {
            const meta = transaction.getMeta(tokenHighlightKey)
            const known = meta ? toSet(meta.knownTokens) : previous.known

            // Rebuild when the doc changed OR the vocabulary did; otherwise map
            // the existing set forward, so a selection move in a long contract
            // does not re-scan every text node.
            if (transaction.docChanged || meta) {
              return { known, decorations: buildDecorations(transaction.doc, known) }
            }
            return { known, decorations: previous.decorations.map(transaction.mapping, transaction.doc) }
          },
        },
        props: {
          decorations(state) {
            return tokenHighlightKey.getState(state)?.decorations
          },
        },
      }),
    ]
  },
})

export default TokenHighlight
