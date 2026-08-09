/**
 * Per-change comment thread JSON stored in `data-comment` on track-change marks.
 * The shape is shared across all host apps (tenant + lawyer conversation).
 */

export interface CommentEntry {
  id: string
  text: string
  author?: string
  createdAt?: string
}

export interface CommentPayload {
  entries: CommentEntry[]
  updatedAt?: string
  resolved?: boolean
}

/** Returns null for empty input; plain (non-JSON) text is upgraded to a single legacy entry. */
export function parseCommentPayload(raw: string | null | undefined): CommentPayload | null
export function serializeCommentPayload(payload: CommentPayload | null): string
export function hasActiveCommentThread(payload: CommentPayload | null): boolean
export function appendCommentEntry(
  existing: CommentPayload | string | null,
  text: string,
  author: string,
  editingIndex?: number | null,
): CommentPayload
export function resolveCommentPayload(existing: CommentPayload | string | null): CommentPayload
export function reopenCommentPayload(existing: CommentPayload | string | null): CommentPayload
export function normalizeCommentAuthorName(name: string | null | undefined): string
export function isCommentAuthor(
  entryAuthor: string | null | undefined,
  currentUserName: string | null | undefined,
): boolean
