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
export function getAuthorColorIndex(...args: unknown[]): number
