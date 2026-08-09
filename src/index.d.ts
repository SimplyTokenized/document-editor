/**
 * Hand-written types for `@simplytokenized/document-editor`.
 *
 * The implementation is untyped JS/JSX (~6,400 lines carried over from the original
 * in-app folders). Rather than turn on `allowJs` and strict-check all of it, this file
 * gives TypeScript consumers just enough shape for their own call sites to compile.
 * Keep it in step by hand when the public API changes; anything not declared here is
 * simply not part of the supported surface.
 */

import type { ComponentType } from 'react'

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
}

export const ContractEditor: ComponentType<ContractEditorProps>

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
