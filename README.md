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

## Theming

The editor ships a neutral light theme and reads every colour through a `--doc-editor-*`
custom property. Redeclare any of them — on `:root`, or on any ancestor of the editor to
scope it — and the editor re-skins. That is the whole contract; nothing else about the
stylesheet is public.

| Token | Used for |
| --- | --- |
| `--doc-editor-primary` / `-on-primary` | active toolbar buttons, links, focus rings, comment-card spine |
| `--doc-editor-bg` / `-bg-muted` | toolbar, popovers, panels, comment cards |
| `--doc-editor-fg` / `-fg-muted` | chrome text |
| `--doc-editor-border` / `-border-subtle` | all chrome borders |
| `--doc-editor-radius` / `-shadow` | chrome corner radius and popover shadow |
| `--doc-editor-paper` / `-paper-fg` | the document sheet and its body text |
| `--doc-editor-workspace` | the surface the sheet sits on |
| `--doc-editor-page-guide` | the band drawn where a page would break |

Each host maps its own palette in one block — see `src/index.css` in networkmanager and
st-app-assetmanager, and `src/scss/style.scss` in st-networkmanager. Because those blocks
are `var()` references rather than copied values, the editor follows a host's light/dark
switch, and in networkmanager it also follows a network operator's live re-brand, with no
coordination between the two sides.

Two things are deliberate:

- **The sheet is themed separately from the chrome.** All three apps leave
  `--doc-editor-paper` at white with dark text even in dark mode, because the sheet is a
  preview of a printed page. Point it at your background token only if you really want the
  document itself to go dark — and move `-paper-fg` with it.
- **Redline colours are not tokens.** Insertion, deletion and comment marks carry legal
  meaning in a review, and a re-brand that recoloured them could make two states
  indistinguishable. They stay fixed.

Earlier versions read CoreUI's `--cui-*` variables directly, which meant the editor only
themed itself inside the CoreUI app and silently fell back to hardcoded greys everywhere
else. That coupling is gone: knowledge of CoreUI now lives in the CoreUI app's own
stylesheet, alongside the equivalent mapping in each shadcn app.

## How apps link to it

Each app declares it with yarn's `link:` protocol, which symlinks this working copy into
the app's `node_modules` — so an edit here is live in every app's dev server with no
publish, build or reinstall step:

```json
"@simplytokenized/document-editor": "link:../document-editor"
```

This assumes all repos are checked out as siblings under the same parent directory.

This package has no `node_modules` of its own and needs no install or build step.

Because `link:` does not install a linked package's dependencies, everything this module
needs is declared as a **peer dependency** and must be present in the host app's
`package.json`. Each host also needs two Vite settings, both of which exist only because
the linked source lives outside the app's root:

```js
import { documentEditorDedupe } from '@simplytokenized/document-editor/vite-dedupe'

resolve: {
  dedupe: [...documentEditorDedupe],
},
server: {
  fs: { allow: ['..'] },  // let the dev server serve files from the sibling checkout
},
```

`vite-dedupe.js` is exported from this package rather than copy-pasted into each app so
that adding a dependency here cannot silently break the others — see the comment in that
file for what goes wrong without it (a Rollup "failed to resolve import" at build time, or
two copies of React/ProseMirror at dev time).

## Types

The implementation is untyped JS/JSX. Hand-written `.d.ts` files next to each entry point
describe the supported public surface — see `src/index.d.ts`. When you add a public export,
add its declaration too; anything undeclared is not part of the supported API.

These declarations deliberately do **not** reference React's own types. The host apps are
not on the same `@types/react` major — the asset manager still declares 18 while running
React 19 — and typing the component as `ComponentType<Props>` against one major makes the
other reject it as a JSX element (TS2786). `ContractEditor` is therefore declared as a
plain function returning `any`, which every version accepts while keeping its props fully
checked.

## History

Each app used to carry its own copy of this folder, kept in step by an rsync script
(`st-networkmanager/scripts/sync-contract-editor.sh`) that named `st-networkmanager` the
canonical source. By the time this package was extracted the copies had already drifted:
`networkmanager` had gained the zoom / auto-fit feature and a null-guard in the toolbar
state selector that the other two never received. This package was seeded from that
newest version, so the extraction also brought the other two apps up to date. The sync
script and the `SYNCED.md` markers are gone.
