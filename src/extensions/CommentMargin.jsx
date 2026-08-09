/**
 * CommentMargin — an in-editor comment / track-changes gutter.
 *
 * Renders the review cards INSIDE the editor's scroll container (not as a detached host
 * sidebar), each card absolutely positioned next to the text it annotates. Because it lives
 * in the same scrolling / fullscreen element as the document, the cards scroll with the text
 * and stay visible in fullscreen — and a thin leader connects each card to its anchor.
 *
 * Framework-neutral: plain buttons + scss classes, no CoreUI / shadcn. Reads and mutates the
 * shared redline marks through the same engine helpers both apps use.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import {
  getChanges,
  acceptChange,
  rejectChange,
  flagChangeWithLawyerComment,
  unflagChange,
  isLawyerAuthor,
} from './trackChangesUtils.js'
import {
  saveCommentOnChange,
  resolveCommentOnChange,
  reopenCommentOnChange,
} from './changeCommentEditor.js'
import { parseCommentPayload, isCommentAuthor } from './changeCommentPayload.js'
import { AUTHOR_COLORS, getAuthorColorIndex } from './authorColors.js'

const CARD_GAP = 12 // vertical space kept between stacked cards
const DEFAULT_MARGIN_LABELS = {
  removed: 'Removed',
  added: 'Added',
  selectedText: 'Selected text',
  accept: 'Accept',
  reject: 'Reject',
  revert: 'Revert',
  resolve: 'Resolve',
  reopen: 'Reopen discussion',
  addComment: 'Add comment',
  reply: 'Reply',
  edit: 'Edit',
  save: 'Save',
  cancel: 'Cancel',
  commentPlaceholder: 'Write your comment…',
  resolved: 'Resolved',
  lawyer: 'Lawyer',
  lawyerRejected: 'Lawyer rejected',
  lawyerReason: "Lawyer's reason",
  flag: 'Flag',
  flagReason: 'Why are you rejecting this change?',
  undoFlag: 'Undo',
  flagged: 'Flagged',
  yourEdit: 'Your edit',
  emptyTitle: 'No tracked changes yet',
  emptyHint: 'Edits and comments on the text appear here, next to what they refer to.',
  addedThisText: 'added this text.',
  removedThisText: 'removed this text.',
  commentedThisText: 'commented on this text.',
}

/**
 * Pair an adjacent tracked deletion + insertion by the same author into one "changed X to Y"
 * card (Word-style), and keep comment-only marks as their own cards. Ported from the asset
 * manager's ChangesSidebar so the cards read identically in both apps.
 */
function combineRelatedChanges(changes) {
  if (!changes.length) return []
  const sorted = [...changes].sort((a, b) => a.from - b.from)
  const used = new Set()
  const combined = []

  const rangeDistance = (a, b) => {
    if (a.to < b.from) return b.from - a.to
    if (b.to < a.from) return a.from - b.to
    return 0
  }

  const findPartner = (current, startIdx) => {
    for (let j = startIdx + 1; j < sorted.length; j++) {
      if (used.has(j)) continue
      const cand = sorted[j]
      if (cand.author !== current.author) continue
      if (current.type === 'comment' || cand.type === 'comment') continue
      if (cand.type === current.type) continue
      if (rangeDistance(current, cand) > 4) continue
      return j
    }
    return -1
  }

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue
    const current = sorted[i]
    if (current.type === 'comment') {
      used.add(i)
      combined.push({ author: current.author, commentOnly: current, anchor: current })
      continue
    }
    const partnerIdx = findPartner(current, i)
    if (partnerIdx !== -1) {
      const partner = sorted[partnerIdx]
      used.add(i)
      used.add(partnerIdx)
      const removed = current.type === 'deletion' ? current : partner
      const added = current.type === 'insertion' ? current : partner
      combined.push({ author: current.author, removed, added, anchor: added })
    } else {
      used.add(i)
      combined.push({
        author: current.author,
        removed: current.type === 'deletion' ? current : undefined,
        added: current.type === 'insertion' ? current : undefined,
        anchor: current,
      })
    }
  }
  return combined
}

const cardKeyOf = (c) => {
  const a = c.added ? `i${c.added.from}-${c.added.to}` : ''
  const r = c.removed ? `d${c.removed.from}-${c.removed.to}` : ''
  const m = c.commentOnly ? `c${c.commentOnly.from}-${c.commentOnly.to}` : ''
  return `${c.author}|${a}${r}${m}`
}

const displayAuthor = (author, labels) => {
  const raw = String(author || 'Unknown')
  const lower = raw.toLowerCase()
  const isLawyer = lower.includes('lawyer')
  const name = raw.replace(/\s*\((lawyer|user)\)/i, '').trim() || 'Unknown'
  return { name, isLawyer, roleLabel: isLawyer ? labels.lawyer : null }
}

/** Accept both halves of a combined change in a single transaction (positions stay valid). */
const acceptCombined = (editor, card) => {
  if (card.added) acceptChange(editor, card.added) // keep text, drop insertion mark
  // Re-derive the deletion after the first dispatch so its range is current.
  if (card.removed) {
    const fresh = getChanges(editor).find(
      (c) =>
        c.type === 'deletion' && c.author === card.removed.author && c.text === card.removed.text,
    )
    acceptChange(editor, fresh || card.removed) // remove deleted text
  }
}

const rejectCombined = (editor, card) => {
  if (card.removed) rejectChange(editor, card.removed) // restore deleted text
  if (card.added) {
    const fresh = getChanges(editor).find(
      (c) => c.type === 'insertion' && c.author === card.added.author && c.text === card.added.text,
    )
    rejectChange(editor, fresh || card.added) // remove inserted text
  }
}

/**
 * Lawyer "reject" = flag WITH a reason: the mark stays in the document (so the tenant sees
 * exactly what was rejected and why) and the decision is recorded on the mark. Both halves of
 * a combined replace are flagged so the change counts as fully reviewed.
 */
const flagCombined = (editor, card, lawyerName, reason) => {
  if (card.added) flagChangeWithLawyerComment(editor, card.added, lawyerName, reason)
  if (card.removed) {
    const fresh = getChanges(editor).find(
      (c) =>
        c.type === 'deletion' && c.author === card.removed.author && c.text === card.removed.text,
    )
    flagChangeWithLawyerComment(editor, fresh || card.removed, lawyerName, reason)
  }
}

const unflagCombined = (editor, card) => {
  if (card.added) unflagChange(editor, card.added)
  if (card.removed) {
    const fresh = getChanges(editor).find(
      (c) =>
        c.type === 'deletion' && c.author === card.removed.author && c.text === card.removed.text,
    )
    unflagChange(editor, fresh || card.removed)
  }
}

const flashAnchor = (editor, anchor) => {
  if (!editor || editor.isDestroyed || !anchor) return
  editor.chain().focus().setTextSelection({ from: anchor.from, to: anchor.to }).run()
  const domNode = editor.view.nodeDOM(anchor.from)
  const el =
    (domNode instanceof HTMLElement ? domNode : domNode?.parentElement)?.closest(
      'ins.legal-insertion, del.legal-deletion, span.legal-comment, .legal-insertion, .legal-deletion, .legal-comment',
    ) ||
    (domNode instanceof HTMLElement ? domNode : domNode?.parentElement) ||
    null
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.remove('legal-anchor-flash')
  void el.offsetWidth
  el.classList.add('legal-anchor-flash')
  window.setTimeout(() => el.classList.remove('legal-anchor-flash'), 1100)
}

const CommentThread = ({ card, editor, mode, currentUserName, labels, onChanged }) => {
  const target = card.added || card.removed || card.commentOnly
  const payload = parseCommentPayload(target?.comment)
  const entries = payload?.entries || []
  const resolved = Boolean(payload?.resolved)
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingIndex, setEditingIndex] = useState(null)
  const readOnly = mode === 'readOnly'

  const openNew = () => {
    setEditingIndex(null)
    setDraft('')
    setComposing(true)
  }
  const openEdit = (idx, text) => {
    setEditingIndex(idx)
    setDraft(text)
    setComposing(true)
  }
  const cancel = () => {
    setComposing(false)
    setDraft('')
    setEditingIndex(null)
  }
  const save = () => {
    const text = draft.trim()
    if (!text || !target) return
    if (saveCommentOnChange(editor, target, text, currentUserName, editingIndex)) {
      cancel()
      onChanged?.()
    }
  }

  return (
    <div className="legal-comment-card__thread">
      {resolved ? <span className="legal-comment-card__badge">{labels.resolved}</span> : null}
      {entries.map((entry, idx) => (
        <div className="legal-comment-card__entry" key={entry.id || idx}>
          {entry.author ? (
            <div className="legal-comment-card__entry-author">{entry.author}</div>
          ) : null}
          <div className="legal-comment-card__entry-text">{entry.text}</div>
          {!readOnly && !resolved && isCommentAuthor(entry.author, currentUserName) ? (
            <button
              type="button"
              className="legal-comment-card__link"
              onClick={() => openEdit(idx, entry.text)}
            >
              {labels.edit}
            </button>
          ) : null}
        </div>
      ))}

      {composing && !readOnly ? (
        <div className="legal-comment-card__composer" onClick={(e) => e.stopPropagation()}>
          <textarea
            className="legal-comment-card__textarea"
            value={draft}
            autoFocus
            placeholder={labels.commentPlaceholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
              if (e.key === 'Escape') cancel()
            }}
          />
          <div className="legal-comment-card__composer-actions">
            <button type="button" className="legal-comment-card__link" onClick={cancel}>
              {labels.cancel}
            </button>
            <button
              type="button"
              className="legal-comment-card__btn legal-comment-card__btn--primary"
              onClick={save}
            >
              {labels.save}
            </button>
          </div>
        </div>
      ) : !readOnly ? (
        <div className="legal-comment-card__thread-actions">
          {resolved ? (
            <button
              type="button"
              className="legal-comment-card__link"
              onClick={() => {
                if (reopenCommentOnChange(editor, target)) onChanged?.()
              }}
            >
              {labels.reopen}
            </button>
          ) : (
            <>
              <button type="button" className="legal-comment-card__link" onClick={openNew}>
                {entries.length ? labels.reply : labels.addComment}
              </button>
              {entries.length ? (
                <button
                  type="button"
                  className="legal-comment-card__link legal-comment-card__link--muted"
                  onClick={() => {
                    if (resolveCommentOnChange(editor, target)) onChanged?.()
                  }}
                >
                  {labels.resolve}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

CommentThread.propTypes = {
  card: PropTypes.object.isRequired,
  editor: PropTypes.object.isRequired,
  mode: PropTypes.oneOf(['reviewer', 'author', 'lawyer', 'commentOnly', 'readOnly']).isRequired,
  currentUserName: PropTypes.string,
  labels: PropTypes.object.isRequired,
  onChanged: PropTypes.func,
}

/**
 * @param {object}  props
 * @param {object}  props.editor            live TipTap editor
 * @param {object}  props.scrollRef         ref to the scroll container the cards live in
 * @param {string}  props.mode              'reviewer' | 'commentOnly' | 'readOnly'
 * @param {string}  props.currentUserName
 * @param {object}  props.labels
 * @param {{from:number,to:number}|null} props.pendingCommentTarget  toolbar "add comment" target
 * @param {Function} props.onCommentTargetHandled
 * @param {Function} props.onHasCommentsChange  reports whether any cards are shown
 */
const CommentMargin = ({
  editor,
  scrollRef,
  mode,
  currentUserName,
  labels: labelsProp,
  pendingCommentTarget,
  onCommentTargetHandled,
  onHasCommentsChange,
}) => {
  const labels = { ...DEFAULT_MARGIN_LABELS, ...labelsProp }
  const marginRef = useRef(null)
  const cardRefs = useRef(new Map())
  // Bumped on every editor transaction / resize so the cards re-derive and re-position.
  const [tick, setTick] = useState(0)
  const [activeKey, setActiveKey] = useState(null)
  // Lawyer mode: which card's "flag with reason" composer is open, and its draft reason.
  const [flaggingKey, setFlaggingKey] = useState(null)
  const [flagDraft, setFlagDraft] = useState('')

  const combined = useMemo(() => {
    if (!editor || editor.isDestroyed) return []
    return combineRelatedChanges(getChanges(editor))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-derive on every tick
  }, [editor, tick])

  // Report presence so the host can reserve the gutter space only when there's something.
  useEffect(() => {
    onHasCommentsChange?.(combined.length > 0)
  }, [combined.length, onHasCommentsChange])

  // Re-measure on document / selection changes.
  useEffect(() => {
    if (!editor) return undefined
    const bump = () => setTick((t) => t + 1)
    editor.on('transaction', bump)
    return () => {
      editor.off('transaction', bump)
    }
  }, [editor])

  // Re-measure when the container resizes (fullscreen toggle, window resize, layout tool).
  useEffect(() => {
    const el = scrollRef?.current
    if (!el) return undefined
    const bump = () => setTick((t) => t + 1)
    const ro = new ResizeObserver(bump)
    ro.observe(el)
    window.addEventListener('resize', bump)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', bump)
    }
  }, [scrollRef])

  // Re-stack whenever ANY card's own height changes (composer opening, a reply added, the
  // textarea being dragged) — otherwise a card that grows would overlap the one below it.
  const cardResizeObserver = useRef(null)
  useEffect(() => {
    cardResizeObserver.current = new ResizeObserver(() => setTick((t) => t + 1))
    return () => cardResizeObserver.current?.disconnect()
  }, [])

  // Position each card next to its anchor, then push overlapping cards down so none collide.
  useLayoutEffect(() => {
    const scrollEl = scrollRef?.current
    const marginEl = marginRef.current
    if (!scrollEl || !marginEl || !editor || editor.isDestroyed) return
    const scrollRect = scrollEl.getBoundingClientRect()
    const docSize = editor.state.doc.content.size

    const items = combined
      .map((card) => {
        const el = cardRefs.current.get(cardKeyOf(card))
        if (!el) return null
        let anchorTop = 0
        try {
          const pos = Math.min(Math.max(1, card.anchor.from), docSize)
          const coords = editor.view.coordsAtPos(pos)
          // Convert viewport coords → scroll-content coords (invariant to current scroll).
          anchorTop = coords.top - scrollRect.top + scrollEl.scrollTop
        } catch {
          anchorTop = 0
        }
        return { el, key: cardKeyOf(card), anchorTop, height: el.offsetHeight }
      })
      .filter(Boolean)
      .sort((a, b) => a.anchorTop - b.anchorTop)

    let cursor = 0
    let maxBottom = 0
    for (const item of items) {
      // The active (just-clicked) card gets to sit exactly at its anchor; others yield to it.
      const top = Math.max(item.anchorTop, cursor)
      item.el.style.top = `${top}px`
      item.el.style.setProperty('--anchor-offset', `${item.anchorTop - top}px`)
      cursor = top + item.height + CARD_GAP
      maxBottom = cursor
    }
    marginEl.style.height = `${Math.max(maxBottom, scrollEl.scrollHeight)}px`
  }, [combined, tick, editor, scrollRef, activeKey])

  // Toolbar "Add comment" → open the composer on the overlapping card.
  useEffect(() => {
    if (!pendingCommentTarget || !combined.length) {
      if (pendingCommentTarget) onCommentTargetHandled?.()
      return
    }
    const match = combined.find((card) => {
      const a = card.anchor
      return Math.max(a.from, pendingCommentTarget.from) <= Math.min(a.to, pendingCommentTarget.to)
    })
    if (match) {
      const key = cardKeyOf(match)
      setActiveKey(key)
      const el = cardRefs.current.get(key)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    onCommentTargetHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommentTarget])

  if (!editor || editor.isDestroyed) return null

  const forceTick = () => setTick((t) => t + 1)

  return (
    <div className="legal-template-editor__comment-margin" ref={marginRef} aria-label="Comments">
      {combined.map((card) => {
        const key = cardKeyOf(card)
        const { name, roleLabel } = displayAuthor(card.author, labels)
        const color = AUTHOR_COLORS[getAuthorColorIndex(card.author) % AUTHOR_COLORS.length]
        const isCommentOnly = Boolean(card.commentOnly)
        // Lawyer mode: is this the lawyer's own tracked edit (vs a tenant change to review)?
        const isOwnEdit = mode === 'lawyer' && isLawyerAuthor(card.author, currentUserName)
        const lawyerRejected =
          card.added?.reviewStatus === 'rejected' || card.removed?.reviewStatus === 'rejected'
        const lawyerReason = String(
          card.added?.reviewComment || card.removed?.reviewComment || '',
        ).replace(/^[^:]+:\s*/, '')

        return (
          <div
            key={key}
            data-card-key={key}
            data-anchor-from={card.anchor.from}
            ref={(el) => {
              const prev = cardRefs.current.get(key)
              if (prev && prev !== el) cardResizeObserver.current?.unobserve(prev)
              if (el) {
                cardRefs.current.set(key, el)
                cardResizeObserver.current?.observe(el)
              } else {
                if (prev) cardResizeObserver.current?.unobserve(prev)
                cardRefs.current.delete(key)
              }
            }}
            className={`legal-comment-card${activeKey === key ? ' legal-comment-card--active' : ''}`}
            style={{ borderLeftColor: color.insertion }}
            role="button"
            tabIndex={0}
            onClick={() => {
              setActiveKey(key)
              flashAnchor(editor, card.anchor)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setActiveKey(key)
                flashAnchor(editor, card.anchor)
              }
            }}
          >
            <span className="legal-comment-card__leader" aria-hidden="true" />
            <div className="legal-comment-card__head" style={{ background: color.bg }}>
              <span
                className="legal-comment-card__avatar"
                style={{ background: `${color.insertion}25`, color: color.insertion }}
              >
                {name.charAt(0).toUpperCase()}
              </span>
              <span className="legal-comment-card__author" title={card.author}>
                {name}
                {roleLabel ? (
                  <span className="legal-comment-card__role"> ({roleLabel})</span>
                ) : null}
              </span>
              {lawyerRejected ? (
                <span className="legal-comment-card__flag">{labels.lawyerRejected}</span>
              ) : null}
              {mode === 'reviewer' && !isCommentOnly ? (
                <span className="legal-comment-card__actions">
                  <button
                    type="button"
                    className="legal-comment-card__btn legal-comment-card__btn--reject"
                    onClick={(e) => {
                      e.stopPropagation()
                      rejectCombined(editor, card)
                      forceTick()
                    }}
                  >
                    {labels.reject}
                  </button>
                  <button
                    type="button"
                    className="legal-comment-card__btn legal-comment-card__btn--accept"
                    onClick={(e) => {
                      e.stopPropagation()
                      acceptCombined(editor, card)
                      forceTick()
                    }}
                  >
                    {labels.accept}
                  </button>
                </span>
              ) : null}
              {mode === 'author' && !isCommentOnly ? (
                <span className="legal-comment-card__actions">
                  <button
                    type="button"
                    className="legal-comment-card__btn legal-comment-card__btn--reject"
                    title={labels.revert}
                    onClick={(e) => {
                      e.stopPropagation()
                      rejectCombined(editor, card)
                      forceTick()
                    }}
                  >
                    {labels.revert}
                  </button>
                </span>
              ) : null}
              {/* Lawyer reviewing the lawyer's OWN tracked edit → Revert only. */}
              {mode === 'lawyer' && isOwnEdit && !isCommentOnly ? (
                <span className="legal-comment-card__actions">
                  <button
                    type="button"
                    className="legal-comment-card__btn legal-comment-card__btn--reject"
                    title={labels.revert}
                    onClick={(e) => {
                      e.stopPropagation()
                      rejectCombined(editor, card)
                      forceTick()
                    }}
                  >
                    {labels.revert}
                  </button>
                </span>
              ) : null}
              {/* Lawyer reviewing a TENANT change → Accept, or Flag-with-reason / Undo-flag. */}
              {mode === 'lawyer' && !isOwnEdit && !isCommentOnly ? (
                <span className="legal-comment-card__actions">
                  {lawyerRejected ? (
                    <button
                      type="button"
                      className="legal-comment-card__btn legal-comment-card__btn--reject"
                      onClick={(e) => {
                        e.stopPropagation()
                        unflagCombined(editor, card)
                        forceTick()
                      }}
                    >
                      {labels.undoFlag}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="legal-comment-card__btn legal-comment-card__btn--reject"
                        onClick={(e) => {
                          e.stopPropagation()
                          setFlaggingKey(key)
                          setFlagDraft('')
                        }}
                      >
                        {labels.flag}
                      </button>
                      <button
                        type="button"
                        className="legal-comment-card__btn legal-comment-card__btn--accept"
                        onClick={(e) => {
                          e.stopPropagation()
                          acceptCombined(editor, card)
                          forceTick()
                        }}
                      >
                        {labels.accept}
                      </button>
                    </>
                  )}
                </span>
              ) : null}
            </div>

            <div className="legal-comment-card__body" onClick={(e) => e.stopPropagation()}>
              {isCommentOnly ? (
                <div className="legal-comment-card__text legal-comment-card__text--quote">
                  {labels.selectedText}: &ldquo;{card.commentOnly.text}&rdquo;
                </div>
              ) : null}
              {card.removed ? (
                <div className="legal-comment-card__text legal-comment-card__text--removed">
                  − {labels.removed}: &ldquo;{card.removed.text}&rdquo;
                </div>
              ) : null}
              {card.added ? (
                <div className="legal-comment-card__text legal-comment-card__text--added">
                  + {labels.added}: &ldquo;{card.added.text}&rdquo;
                </div>
              ) : null}

              {lawyerRejected && lawyerReason ? (
                <div className="legal-comment-card__reason">
                  <strong>{labels.lawyerReason}: </strong>
                  {lawyerReason}
                </div>
              ) : null}

              {mode === 'lawyer' && flaggingKey === key ? (
                <div className="legal-comment-card__composer">
                  <textarea
                    className="legal-comment-card__textarea"
                    value={flagDraft}
                    autoFocus
                    placeholder={labels.flagReason}
                    onChange={(e) => setFlagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setFlaggingKey(null)
                    }}
                  />
                  <div className="legal-comment-card__composer-actions">
                    <button
                      type="button"
                      className="legal-comment-card__link"
                      onClick={() => setFlaggingKey(null)}
                    >
                      {labels.cancel}
                    </button>
                    <button
                      type="button"
                      className="legal-comment-card__btn legal-comment-card__btn--primary"
                      disabled={!flagDraft.trim()}
                      onClick={() => {
                        const reason = flagDraft.trim()
                        if (!reason) return
                        flagCombined(editor, card, currentUserName, reason)
                        setFlaggingKey(null)
                        setFlagDraft('')
                        forceTick()
                      }}
                    >
                      {labels.flag}
                    </button>
                  </div>
                </div>
              ) : null}

              <CommentThread
                card={card}
                editor={editor}
                mode={mode}
                currentUserName={currentUserName}
                labels={labels}
                onChanged={forceTick}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

CommentMargin.propTypes = {
  editor: PropTypes.object,
  scrollRef: PropTypes.shape({ current: PropTypes.any }),
  mode: PropTypes.oneOf(['reviewer', 'author', 'lawyer', 'commentOnly', 'readOnly']),
  currentUserName: PropTypes.string,
  labels: PropTypes.object,
  pendingCommentTarget: PropTypes.shape({ from: PropTypes.number, to: PropTypes.number }),
  onCommentTargetHandled: PropTypes.func,
  onHasCommentsChange: PropTypes.func,
}

export default CommentMargin
