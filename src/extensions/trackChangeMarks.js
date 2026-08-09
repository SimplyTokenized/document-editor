import { Mark, mergeAttributes } from '@tiptap/core'
import { getAuthorColorIndex } from './authorColors.js'

/**
 * TipTap marks that render and parse tracked insertions (<ins>) and deletions (<del>)
 * produced by the tenant's track-changes editor in the asset manager.
 *
 * Attribute responsibilities are kept strictly separate so nothing is ambiguous:
 *   - author        : who made the edit (the tenant)
 *   - comment        : the TENANT's own annotation on the change (auto-default or note)
 *   - reviewStatus   : the LAWYER's decision — null (unreviewed) or "rejected" (flagged)
 *   - reviewComment  : the LAWYER's reason when rejecting
 *
 * The lawyer's decision lives in its own attributes (data-review-status / data-review-comment)
 * and never overwrites the tenant's comment, so the two can't be confused on either side.
 */

const trackedAttributes = () => ({
  author: {
    default: null,
    parseHTML: (el) => el.getAttribute('data-author'),
    renderHTML: (attrs) =>
      attrs.author ? { 'data-author': attrs.author, title: attrs.author } : {},
  },
  comment: {
    default: null,
    parseHTML: (el) => el.getAttribute('data-comment'),
    renderHTML: (attrs) => (attrs.comment ? { 'data-comment': attrs.comment } : {}),
  },
  reviewStatus: {
    default: null,
    parseHTML: (el) => el.getAttribute('data-review-status'),
    renderHTML: (attrs) => (attrs.reviewStatus ? { 'data-review-status': attrs.reviewStatus } : {}),
  },
  reviewComment: {
    default: null,
    parseHTML: (el) => el.getAttribute('data-review-comment'),
    renderHTML: (attrs) =>
      attrs.reviewComment ? { 'data-review-comment': attrs.reviewComment } : {},
  },
})

export const InsertionMark = Mark.create({
  name: 'insertion',
  addAttributes() {
    return trackedAttributes()
  },
  parseHTML() {
    return [
      {
        tag: 'ins[data-author]',
        getAttrs: (node) => ({
          author: node.getAttribute('data-author'),
          comment: node.getAttribute('data-comment'),
          reviewStatus: node.getAttribute('data-review-status'),
          reviewComment: node.getAttribute('data-review-comment'),
        }),
      },
      {
        tag: 'ins',
        getAttrs: (node) => ({
          author: node.getAttribute('data-author') || 'Unknown',
          comment: node.getAttribute('data-comment'),
          reviewStatus: node.getAttribute('data-review-status'),
          reviewComment: node.getAttribute('data-review-comment'),
        }),
      },
    ]
  },
  renderHTML({ mark, HTMLAttributes }) {
    const author = mark.attrs?.author ?? HTMLAttributes['data-author']
    const colorIdx = getAuthorColorIndex(String(author || ''))
    return [
      'ins',
      mergeAttributes(HTMLAttributes, {
        class: 'legal-insertion',
        'data-author-color': String(colorIdx),
      }),
      0,
    ]
  },
})

export const DeletionMark = Mark.create({
  name: 'deletion',
  addAttributes() {
    return trackedAttributes()
  },
  parseHTML() {
    return [{ tag: 'del' }, { tag: 's[data-author]' }]
  },
  renderHTML({ mark, HTMLAttributes }) {
    const author = mark.attrs?.author ?? HTMLAttributes['data-author']
    const colorIdx = getAuthorColorIndex(String(author || ''))
    return [
      'del',
      mergeAttributes(HTMLAttributes, {
        class: 'legal-deletion',
        'data-author-color': String(colorIdx),
      }),
      0,
    ]
  },
})
