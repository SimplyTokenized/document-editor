/**
 * Framework-agnostic helpers to list and resolve tracked changes in a TipTap/ProseMirror
 * editor that has the `insertion` and `deletion` marks registered. Ported from the asset
 * manager's ChangesSidebar accept/reject logic.
 *
 * Positions are read fresh from the live editor state on each render, so a change object's
 * `from`/`to` are valid at click time; after a transaction the editor re-renders and the
 * list is re-derived.
 */

/**
 * True if the HTML still carries unresolved tracked changes (`<ins>`/`<del>` from the redline
 * marks). The lawyer must accept/reject everything before approving, so this gates the approve
 * action and keeps redline out of the generated PDF.
 *
 * @param {string|null|undefined} html
 * @returns {boolean}
 */
export function hasUnresolvedChanges(html) {
  return /<(ins|del)\b/i.test(String(html || ''))
}

export function getChanges(editor) {
  if (!editor || editor.isDestroyed) return []
  const { state } = editor
  const insertion = state.schema.marks.insertion
  const deletion = state.schema.marks.deletion
  const comment = state.schema.marks.comment
  if (!insertion || !deletion) return []

  const result = []
  state.doc.descendants((node, pos) => {
    if (!node.isText) return undefined
    for (const mark of node.marks) {
      const isInsertion = mark.type === insertion
      const isDeletion = mark.type === deletion
      const isComment = comment && mark.type === comment
      if (!isInsertion && !isDeletion && !isComment) continue

      const text = (node.text || '').trim()
      if (!text) return undefined

      const type = isInsertion ? 'insertion' : isDeletion ? 'deletion' : 'comment'
      result.push({
        author: mark.attrs?.author || 'Unknown',
        type,
        text,
        comment: mark.attrs?.comment || null,
        reviewStatus: mark.attrs?.reviewStatus || null,
        reviewComment: mark.attrs?.reviewComment || null,
        isLawyerFlagged: mark.attrs?.reviewStatus === 'rejected',
        from: pos,
        to: pos + node.nodeSize,
      })
      return undefined
    }
    return undefined
  })
  return result
}

export function getTrackChanges(editor) {
  return getChanges(editor).filter((c) => c.type === 'insertion' || c.type === 'deletion')
}

export function getCommentOnlyChanges(editor) {
  return getChanges(editor).filter((c) => c.type === 'comment')
}

/**
 * True when at least one tracked change still needs a lawyer decision (it has not been
 * flagged/rejected, and accepting removes the mark entirely). Gates the approve action.
 */
export function hasUncommentedChanges(editor) {
  if (!editor || editor.isDestroyed) return false
  return getTrackChanges(editor).some((c) => !c.isLawyerFlagged)
}

/**
 * Flags a tracked change as rejected by the lawyer. The mark stays in the document
 * (so the tenant sees exactly which edit was rejected) and the decision is recorded
 * in reviewStatus/reviewComment — the tenant's own `comment` is preserved untouched.
 */
export function flagChangeWithLawyerComment(editor, change, lawyerName, commentText) {
  if (!editor || editor.isDestroyed || !change) return
  const { state } = editor
  const markType =
    change.type === 'insertion' ? state.schema.marks.insertion : state.schema.marks.deletion
  if (!markType) return

  const tr = state.tr.removeMark(change.from, change.to, markType).addMark(
    change.from,
    change.to,
    markType.create({
      author: change.author,
      comment: change.comment, // preserve the tenant's annotation
      reviewStatus: 'rejected',
      reviewComment: `${lawyerName}: ${commentText}`,
    }),
  )
  tr.setMeta('skipTrackChanges', true)
  editor.view.dispatch(tr)
}

/** Removes a lawyer flag from a change, moving it back to "Needs review". */
export function unflagChange(editor, change) {
  if (!editor || editor.isDestroyed || !change) return
  const { state } = editor
  const markType =
    change.type === 'insertion' ? state.schema.marks.insertion : state.schema.marks.deletion
  if (!markType) return

  const tr = state.tr.removeMark(change.from, change.to, markType).addMark(
    change.from,
    change.to,
    markType.create({
      author: change.author,
      comment: change.comment, // preserve the tenant's annotation
      reviewStatus: null,
      reviewComment: null,
    }),
  )
  tr.setMeta('skipTrackChanges', true)
  editor.view.dispatch(tr)
}

export function acceptChange(editor, change) {
  if (!editor || editor.isDestroyed || !change) return
  if (change.type === 'comment') return
  const { state } = editor
  const insertion = state.schema.marks.insertion
  const deletion = state.schema.marks.deletion
  if (!insertion || !deletion) return

  let tr = state.tr
  if (change.type === 'insertion') {
    // Accept an insertion: keep the text, drop the tracked mark.
    tr = tr.removeMark(change.from, change.to, insertion)
  } else {
    // Accept a deletion: remove the deleted text.
    tr = tr.delete(change.from, change.to)
  }
  tr.setMeta('skipTrackChanges', true)
  editor.view.dispatch(tr)
}

export function rejectChange(editor, change) {
  if (!editor || editor.isDestroyed || !change) return
  if (change.type === 'comment') return
  const { state } = editor
  const insertion = state.schema.marks.insertion
  const deletion = state.schema.marks.deletion
  if (!insertion || !deletion) return

  let tr = state.tr
  if (change.type === 'insertion') {
    // Reject an insertion: remove the inserted text.
    tr = tr.delete(change.from, change.to)
  } else {
    // Reject a deletion: restore the text by dropping the deletion mark.
    tr = tr.removeMark(change.from, change.to, deletion)
  }
  tr.setMeta('skipTrackChanges', true)
  editor.view.dispatch(tr)
}

export function resolveAllChanges(editor, action) {
  if (!editor || editor.isDestroyed) return
  let guard = 0
  while (guard < 2000) {
    guard += 1
    const changes = getTrackChanges(editor)
    if (changes.length === 0) break
    const change = changes[0]
    if (action === 'accept') acceptChange(editor, change)
    else rejectChange(editor, change)
  }
}

/** @param {string} author @param {string} lawyerName */
export function isLawyerAuthor(author, lawyerName) {
  if (!lawyerName) return false
  return (
    String(author || '')
      .trim()
      .toLowerCase() === String(lawyerName).trim().toLowerCase()
  )
}

export function getTenantChangesForReview(editor, lawyerName) {
  return getTrackChanges(editor).filter((c) => !isLawyerAuthor(c.author, lawyerName))
}

export function getLawyerEdits(editor, lawyerName) {
  return getTrackChanges(editor).filter((c) => isLawyerAuthor(c.author, lawyerName))
}

export function hasPendingTenantReviews(editor, lawyerName) {
  return getTenantChangesForReview(editor, lawyerName).some((c) => !c.isLawyerFlagged)
}

export function hasLawyerEditsInDocument(editor, lawyerName) {
  return getLawyerEdits(editor, lawyerName).length > 0
}
