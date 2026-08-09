/**
 * The list of packages a host app must put in Vite's `resolve.dedupe`, exported from here
 * so it lives in exactly one place.
 *
 * Why it is needed: this module is consumed through yarn's `link:` protocol, so its source
 * sits in a sibling checkout rather than inside the host app. Vite/Rollup resolve a file's
 * bare imports relative to that file's real location — and this checkout has no
 * `node_modules` of its own — so every bare import below would either fail to resolve at
 * build time ("Rollup failed to resolve import ...") or, worse, quietly find a second copy
 * of a package at dev time. Two Reacts is "invalid hook call"; two ProseMirror schemas make
 * Fragment fail `instanceof` against itself, which breaks Enter/split in the editor.
 * `dedupe` forces each of these to resolve from the host app's own node_modules.
 *
 * Keep this in step with the `peerDependencies` in package.json: anything this module
 * imports by bare specifier belongs here. `sass` is deliberately absent — the bundler
 * consumes it, this module never imports it.
 */
export const documentEditorDedupe = [
  'react',
  'react-dom',
  '@tiptap/core',
  '@tiptap/extension-highlight',
  '@tiptap/extension-image',
  '@tiptap/extension-link',
  '@tiptap/extension-placeholder',
  '@tiptap/extension-strike',
  '@tiptap/extension-table',
  '@tiptap/extension-text-align',
  '@tiptap/extension-text-style',
  '@tiptap/extension-underline',
  '@tiptap/pm',
  '@tiptap/react',
  '@tiptap/starter-kit',
  'classnames',
  'docx',
  'jszip',
  'prop-types',
  // Not imported directly, but @tiptap/pm re-exports these and a split version pair is the
  // exact "Fragment is not an instance of Fragment" crash described above.
  'prosemirror-model',
  'prosemirror-state',
  'prosemirror-view',
  'prosemirror-transform',
  'prosemirror-commands',
  'prosemirror-keymap',
  'prosemirror-schema-list',
  'prosemirror-history',
]

export default documentEditorDedupe
