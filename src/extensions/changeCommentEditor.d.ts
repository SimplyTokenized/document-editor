/** Editor-level commands for reading and writing the comment thread on a track-change mark. */

import type { CommentPayload } from './changeCommentPayload.js'
import type { TrackedChange } from './trackChangesUtils.js'

export function getMarkTypeForChange(state: unknown, change: TrackedChange): unknown
export function applyCommentPayloadToChange(
  editor: unknown,
  change: TrackedChange,
  payload: CommentPayload | null,
): void
export function saveCommentOnChange(
  editor: unknown,
  change: TrackedChange,
  text: string,
  authorName: string,
  editingIndex?: number | null,
): void
export function resolveCommentOnChange(editor: unknown, change: TrackedChange): void
export function reopenCommentOnChange(editor: unknown, change: TrackedChange): void
/** Wraps the current selection in a comment mark and hands the range to the host composer. */
export function requestCommentOnSelection(
  editor: unknown,
  currentUserName: string,
  onRequestTarget?: (range: { from: number; to: number }) => void,
): void
export function findChangeOverlappingTarget(
  changes: TrackedChange[],
  target: { from: number; to: number },
): TrackedChange | null
