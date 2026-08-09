# @simplytokenized/document-editor

The shared legal-document editor: a TipTap-based editor with a full track-changes
(redline) engine, per-change comment threads, `.docx` import/export, PDF export, tables
with cell shading, and page layout/guides.

This package is the **single copy** of that source. It is consumed by:

| App | Repo | Imported as |
| --- | --- | --- |
| Network Manager | `networkmanager` | `@simplytokenized/document-editor` |
| Network Manager (CoreUI) | `st-networkmanager` | `@simplytokenized/document-editor` |
| Asset Manager | `st-app-assetmanager` | `@simplytokenized/document-editor` |

It deliberately does **not** depend on any host app's UI kit (CoreUI, shadcn) — it ships
its own toolbar and margin UI, and each app supplies its own review sidebar as a thin view
over this engine.

## Usage

```jsx
import { ContractEditor, isRichTextContentEmpty } from '@simplytokenized/document-editor'

<ContractEditor
  content={html}
  onChange={setHtml}
  trackChanges={{ enabled: true, currentUserName: 'Jane Doe' }}
  showComments
/>
```

The heavy export paths are reachable as subpaths so the host app can keep them out of its
main chunk:

```js
const { exportHtmlToDocx } = await import('@simplytokenized/document-editor/extensions/docxExport')
const { exportHtmlToPdf } = await import('@simplytokenized/document-editor/extensions/pdfExport')
```

Styles are imported by the component itself (`contract-editor.scss` and
`extensions/tiptap-styles.css`) — host apps do not need to import anything extra, but they
do need `sass` available to their bundler.

## How apps link to it

Each app declares it with yarn's `link:` protocol, which symlinks this working copy into
the app's `node_modules` — so an edit here is live in every app's dev server with no
publish, build or reinstall step:

```json
"@simplytokenized/document-editor": "link:../document-editor"
```

This assumes all repos are checked out as siblings under the same parent directory.

Because `link:` does not install the package's own dependencies, everything this module
needs is declared as a **peer dependency** and must be present in the host app's
`package.json`. Each host also needs two Vite settings, both of which exist because the
linked source lives outside the app's root:

```js
resolve: {
  // Without this the linked module resolves its own copy of React/TipTap from outside
  // the app, and you get two React instances (invalid hook call) or two ProseMirror
  // schemas (Fragment not instanceof Fragment).
  dedupe: ['react', 'react-dom', '@tiptap/core', '@tiptap/react', '@tiptap/pm', ...],
},
server: {
  fs: { allow: ['..'] },  // let the dev server serve files from the sibling checkout
},
```

## Types

The implementation is untyped JS/JSX. Hand-written `.d.ts` files next to each entry point
describe the supported public surface — see `src/index.d.ts`. When you add a public export,
add its declaration too; anything undeclared is not part of the supported API.

## History

Each app used to carry its own copy of this folder, kept in step by an rsync script
(`st-networkmanager/scripts/sync-contract-editor.sh`) that named `st-networkmanager` the
canonical source. By the time this package was extracted the copies had already drifted:
`networkmanager` had gained the zoom / auto-fit feature and a null-guard in the toolbar
state selector that the other two never received. This package was seeded from that
newest version, so the extraction also brought the other two apps up to date. The sync
script and the `SYNCED.md` markers are gone.
