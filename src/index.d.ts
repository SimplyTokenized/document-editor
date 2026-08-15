/**
 * Hand-written types for `@simplytokenized/document-editor`.
 *
 * The implementation is untyped JS/JSX (~6,400 lines carried over from the original
 * in-app folders). Rather than turn on `allowJs` and strict-check all of it, this file
 * gives TypeScript consumers just enough shape for their own call sites to compile.
 * Keep it in step by hand when the public API changes; anything not declared here is
 * simply not part of the supported surface.
 */

export * from './extensions/trackChangesUtils.js'
export * from './extensions/changeCommentEditor.js'
export * from './extensions/changeCommentPayload.js'

export interface ContractEditorLabels {
  [key: string]: string
}

export interface ContractEditorProps {
  content?: string
  onChange?: (html: string) => void
  placeholder?: string
  editable?: boolean
  minHeight?: number
  onEditorReady?: (editor: unknown) => void
  labels?: ContractEditorLabels
  onError?: (message: string, error: unknown) => void
  /** Review mode: enable the track-changes (redline) engine. */
  trackChanges?: { enabled?: boolean; currentUserName?: string }
  /** Show the "Add comment" toolbar button (review mode only). */
  showComments?: boolean
  /** Show the in-editor anchored comment margin (review mode only). Defaults on. */
  showChangeComments?: boolean
  /** Card actions in the margin. `editable`/`commentOnly` override this. */
  commentMode?: 'reviewer' | 'author' | 'lawyer'
  /** Called with the selection range so the host can open its own comment composer. */
  onRequestComment?: (range: { from: number; to: number }) => void
  /** Override the image toolbar button so the host can open its own media picker. */
  onImageRequest?: (editor: unknown) => void
  /** When provided, shows a "Change with AI" toolbar button that calls this. */
  onChangeWithAI?: () => void
  /** Review "comment only" stage: hide formatting tools, keep only commenting. */
  commentOnly?: boolean
  /**
   * Host-supplied controls rendered inside the editor's document-actions bar, so an app can
   * put its own document-level actions (version history, a preview toggle, a comments
   * switch) in the editor chrome instead of floating above it. Typed as `unknown` rather
   * than `ReactNode` to keep this package free of a dependency on React's types — see the
   * note on ContractEditor below. Pass JSX.
   */
  toolbarExtras?: unknown
  /**
   * Host-supplied insert tools rendered in the formatting toolbar next to image/link/table
   * — merge-field placeholders, signature anchors. Same contract as `toolbarExtras`: the
   * editor only renders the node. Pass JSX.
   */
  insertExtras?: unknown
  /**
   * Optional inline document title rendered in the actions bar, right after the File menu.
   * Pass nothing where the editor is only one field among many and the host already has its
   * own title input. Pass JSX.
   */
  titleSlot?: unknown
  /**
   * Replaces the built-in browser-print PDF export. Pass this when the host renders PDFs
   * itself (e.g. server-side) so what the author exports is the same document the system
   * distributes, rather than a second renderer's approximation of it.
   */
  onExportPdf?: () => void
  /**
   * Enables `{{` type-ahead. The editor reports where the cursor is and what has been
   * typed since `{{`; the HOST renders the menu and decides what is in it — the same
   * split as `insertExtras`, since this package knows nothing about merge fields.
   *
   * Pass STABLE function identities. The plugin is configured once, when the editor is
   * created, and will not pick up new closures on re-render.
   */
  /**
   * Every merge field the host recognises, in canonical form
   * (`['{{offering.asset_name}}', '{{wizard.country}}']`). Tokens outside the
   * list render as unknown, so a typo is visible while it can still be fixed
   * rather than at generation time, when it substitutes to nothing and leaves a
   * finished-looking sentence with a word missing.
   *
   * Omit it and NOTHING is marked unknown — a host that has not said what
   * exists must not have its authors' correct tokens flagged as mistakes.
   * Signature anchors are never checked: their roles are bound later, by
   * whichever flow sends the envelope.
   *
   * Re-read whenever the array's contents change, so it may be built inline.
   */
  knownTokens?: string[]
  placeholderSuggestion?: {
    onStateChange?: (state: PlaceholderSuggestionState) => void
    /** Return true when the host's popup consumed the key (arrows, Enter, Escape). */
    onKeyDown?: (event: KeyboardEvent) => boolean
  }
  /**
   * Host tools rendered into the SELECTION bubble menu, beside bold and italic.
   *
   * Distinct from `insertExtras`, which lives in the fixed toolbar and acts at
   * the cursor. This is for anything that acts ON the selected words — the menu
   * is already under the cursor at the moment the author has made a selection,
   * so a gesture that needs one belongs here rather than back up in the toolbar.
   * Pass JSX.
   */
  selectionExtras?: unknown
  /**
   * A panel rendered INSIDE the editor chrome, beside the paper — the same
   * place the comment margin occupies. For tools that belong to the document
   * being edited and would otherwise float next to the editor as a separate
   * box, which reads as a different thing rather than part of this one.
   * Pass JSX.
   */
  sidePanel?: unknown
}

export interface PlaceholderSuggestionState {
  active: boolean
  /** What has been typed after `{{`. */
  query: string
  /** Document positions of the in-progress token, for `completePlaceholder`. */
  range: { from: number; to: number } | null
  /** Viewport coordinates of the trigger, for anchoring a popup. Null when the
   *  position is momentarily not resolvable — anchor on the editor instead. */
  rect: { top: number; bottom: number; left: number; right: number } | null
}

/**
 * Declared as a plain function returning `any` rather than React's `ComponentType`
 * on purpose. The host apps are not on the same `@types/react` major — the asset
 * manager still declares 18 while running React 19 — and a `ComponentType` pinned to
 * one major is rejected as a JSX element type by the other with a baffling
 * "cannot be used as a JSX component / Property 'refs' is missing" error (TS2786).
 * An `any` return is accepted by every version and gives up nothing that matters:
 * the props, which are the part callers need checked, stay fully typed. It also
 * keeps this package free of any dependency on React's own type packages.
 */
export declare function ContractEditor(props: ContractEditorProps): any

export function serializeLegalDocumentEditorHtml(html: string): string
export function getRichTextPlainText(html: string): string
export function isRichTextContentEmpty(html: string): boolean
export function parsePageSetupMarker(html: string): unknown
export function withPageSetupMarker(html: string, marker: unknown): string

export const TrackChangesExtension: unknown
export const InsertionMark: unknown
export const DeletionMark: unknown
export const CommentMark: unknown
/**
 * Marks a passage as conditional. Unlike the `{{…}}` token highlight, this one
 * IS written into the saved HTML — the backend reads the span to decide whether
 * the text belongs in a given tenant's document — so export must unwrap it and a
 * token must never straddle a span boundary.
 *
 * Commands: `setConditionalText({condition, note})`, `toggleConditionalText(…)`,
 * `unsetConditionalText()`. `condition` is an opaque string the host writes and
 * evaluates; this package assigns it no meaning.
 */
export const ConditionalText: unknown

/**
 * Node wrapping block content that is emitted ONCE PER SELECTED ANSWER.
 *
 * Commands: `setRepeatBlock({factKey, note})`, `updateRepeatBlock(…)`,
 * `unsetRepeatBlock()`. `factKey` is opaque here — the host writes it and the
 * host (and backend) resolve it against a run's answers.
 *
 * A node rather than a mark because the content is copied whole; a mark
 * describes inline text and has no body to duplicate.
 */
/**
 * The document as a real, server-rendered PDF in the browser's own viewer.
 *
 * The host supplies `fetchPdf` (endpoint, auth, which document); the package
 * owns the object-URL lifecycle, the cancelled-response race and the three
 * states. Keep `fetchPdf` stable — it is an effect dependency.
 */
export const DocumentPdfPreview: (props: {
  fetchPdf: () => Promise<Blob>
  height?: number | string
  labels?: { title?: string; loading?: string; error?: string }
  toolbar?: unknown
  className?: string
}) => unknown

export const RepeatBlock: unknown
export const REPEAT_BLOCK_ATTR: string
export const CONDITIONAL_TEXT_ATTR: string
export const PlaceholderSuggestion: unknown
export function getAuthorColorIndex(...args: unknown[]): number
