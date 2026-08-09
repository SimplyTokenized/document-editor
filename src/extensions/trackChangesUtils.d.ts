/** Track-changes gating + accept/reject helpers used by the host review workflows. */

/** One redline mark found in the document, as returned by {@link getChanges}. */
export interface TrackedChange {
  author: string
  type: 'insertion' | 'deletion' | 'comment'
  text: string
  /** Raw `data-comment` JSON — parse with `parseCommentPayload`. */
  comment: string | null
  reviewStatus: string | null
  reviewComment: string | null
  isLawyerFlagged: boolean
  from: number
  to: number
}

export function hasUnresolvedChanges(html: string): boolean
export function getChanges(editor: unknown): TrackedChange[]
export function getTrackChanges(editor: unknown): TrackedChange[]
export function getCommentOnlyChanges(editor: unknown): TrackedChange[]
export function hasUncommentedChanges(editor: unknown): boolean
export function flagChangeWithLawyerComment(
  editor: unknown,
  change: TrackedChange,
  lawyerName: string,
  commentText: string,
): void
export function unflagChange(editor: unknown, change: TrackedChange): void
export function acceptChange(editor: unknown, change: TrackedChange): void
export function rejectChange(editor: unknown, change: TrackedChange): void
export function resolveAllChanges(editor: unknown, action: 'accept' | 'reject'): void
export function isLawyerAuthor(author: string, lawyerName: string): boolean
export function getTenantChangesForReview(editor: unknown, lawyerName: string): TrackedChange[]
export function getLawyerEdits(editor: unknown, lawyerName: string): TrackedChange[]
export function hasPendingTenantReviews(editor: unknown, lawyerName: string): boolean
export function hasLawyerEditsInDocument(editor: unknown, lawyerName: string): boolean
