import {
  appendCommentEntry,
  parseCommentPayload,
  reopenCommentPayload,
  resolveCommentPayload,
  serializeCommentPayload,
} from './changeCommentPayload.js'

export function getMarkTypeForChange(state, change) {
  if (change.type === 'insertion') return state.schema.marks.insertion
  if (change.type === 'deletion') return state.schema.marks.deletion
  return state.schema.marks.comment
}

export function applyCommentPayloadToChange(editor, change, payload) {
  if (!editor || editor.isDestroyed || !change) return false
  const { state } = editor
  const markType = getMarkTypeForChange(state, change)
  if (!markType) return false

  const serialized = serializeCommentPayload(payload)
  const tr = state.tr.removeMark(change.from, change.to, markType).addMark(
    change.from,
    change.to,
    markType.create({
      author: change.author,
      comment: serialized,
      reviewStatus: change.reviewStatus || null,
      reviewComment: change.reviewComment || null,
    }),
  )
  tr.setMeta('skipTrackChanges', true)
  editor.view.dispatch(tr)
  return true
}

export function saveCommentOnChange(editor, change, text, authorName, editingIndex = null) {
  const existing = parseCommentPayload(change.comment)
  const payload = appendCommentEntry(existing, text.trim(), authorName, editingIndex)
  return applyCommentPayloadToChange(editor, change, payload)
}

export function resolveCommentOnChange(editor, change) {
  const existing = parseCommentPayload(change.comment)
  if (!existing || existing.entries.length === 0) return false
  return applyCommentPayloadToChange(editor, change, resolveCommentPayload(existing))
}

export function reopenCommentOnChange(editor, change) {
  const existing = parseCommentPayload(change.comment)
  if (!existing || existing.entries.length === 0) return false
  return applyCommentPayloadToChange(editor, change, reopenCommentPayload(existing))
}

/**
 * Toolbar "Add comment" — targets selection or tracked marks, then notifies parent.
 */
export function requestCommentOnSelection(editor, currentUserName, onRequestTarget) {
  if (!editor || editor.isDestroyed) return false

  const initialFrom = editor.state.selection.from
  const initialTo = editor.state.selection.to
  editor.chain().focus().setTextSelection({ from: initialFrom, to: initialTo }).run()

  const { state } = editor
  const insertionMark = state.schema.marks.insertion
  const deletionMark = state.schema.marks.deletion
  const commentMark = state.schema.marks.comment
  if (!insertionMark || !deletionMark || !commentMark) return false

  const from = initialFrom
  const to = initialTo
  const scanFrom = from === to ? Math.max(0, from - 1) : from
  const scanTo = from === to ? Math.min(state.doc.content.size, to + 1) : to

  const segments = []
  state.doc.nodesBetween(scanFrom, Math.max(scanFrom + 1, scanTo), (node, pos) => {
    if (!node.isText) return
    const nodeFrom = pos
    const nodeTo = pos + node.nodeSize
    const intersects =
      from === to ? nodeFrom <= from && nodeTo >= from : nodeTo > from && nodeFrom < to
    if (!intersects) return

    for (const mark of node.marks) {
      if (mark.type !== insertionMark && mark.type !== deletionMark && mark.type !== commentMark) {
        continue
      }
      segments.push({
        from: from === to ? nodeFrom : Math.max(nodeFrom, from),
        to: from === to ? nodeTo : Math.min(nodeTo, to),
        markType: mark.type,
      })
    }
  })

  if (segments.length === 0) {
    if (from === to) return false
    const tr = state.tr.addMark(
      from,
      to,
      commentMark.create({ author: currentUserName, comment: '' }),
    )
    tr.setMeta('skipTrackChanges', true)
    editor.view.dispatch(tr)
    onRequestTarget?.({ from, to })
    return true
  }

  const first = segments[0]
  onRequestTarget?.({ from: first.from, to: first.to })
  return true
}

/** Match a pending toolbar target to a change from getChanges(). */
export function findChangeOverlappingTarget(changes, target) {
  if (!target) return null
  return (
    changes.find((change) => {
      return (
        Math.max(change.from, target.from) <= Math.min(change.to, target.to) ||
        (target.from >= change.from && target.from <= change.to)
      )
    }) ?? null
  )
}
