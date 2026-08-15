/**
 * Public API of `@simplytokenized/document-editor`.
 *
 * A self-contained, framework-neutral TipTap editor + track-changes engine for legal
 * contract documents — ONE implementation, consumed by networkmanager, st-networkmanager
 * and st-app-assetmanager. It brings its own toolbar UI, .docx import/export, PDF export,
 * tables + cell shading, page layout, page guides, and the full redline/comment engine, so
 * it does not depend on the host app's UI kit (CoreUI / shadcn). Each app supplies its own
 * review sidebar as a thin view over this engine.
 *
 * This package holds the single copy of that source. It replaces the previous arrangement
 * where each app carried its own folder kept in step by an rsync script — the copies had
 * already drifted apart by the time this package was extracted.
 *
 * Everything under ./extensions is also reachable directly, e.g.
 * `@simplytokenized/document-editor/extensions/docxExport`, which is how the heavy
 * export paths stay lazily loadable from the host app.
 */

// Editor component
export { default as ContractEditor } from './ContractEditor.jsx'

// Serialization + content helpers
export { serializeLegalDocumentEditorHtml } from './extensions/legalDocumentImage.js'
export { getRichTextPlainText, isRichTextContentEmpty } from './extensions/richText.js'
export { parsePageSetupMarker, withPageSetupMarker } from './extensions/pageSetupMarker.js'

// Track-changes / comment engine (redline) — the shared canonical implementation
export { TrackChangesExtension } from './extensions/TrackChangesExtension.js'
export { InsertionMark, DeletionMark } from './extensions/trackChangeMarks.js'
export { CommentMark } from './extensions/CommentMark.js'
// Display-only chips for `{{merge_field}}` / `{{sign:role.type}}` tokens.
export { TokenHighlight } from './extensions/tokenHighlight.js'
export { ConditionalText, CONDITIONAL_TEXT_ATTR } from './extensions/conditionalText.js'
export { RepeatBlock, REPEAT_BLOCK_ATTR } from './extensions/repeatBlock.js'
export { DocumentPdfPreview } from './DocumentPdfPreview.jsx'
export { PlaceholderSuggestion, placeholderSuggestionKey } from './extensions/placeholderSuggestion.js'
export { getAuthorColorIndex } from './extensions/authorColors.js'
export * from './extensions/trackChangesUtils.js'
export * from './extensions/changeCommentEditor.js'
export * from './extensions/changeCommentPayload.js'
