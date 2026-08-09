import { Mark, mergeAttributes } from '@tiptap/core'
import { getAuthorColorIndex } from './authorColors.js'

export const CommentMark = Mark.create({
  name: 'comment',

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      author: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-author'),
        renderHTML: (attributes) => {
          if (!attributes.author) return {}
          return {
            'data-author': attributes.author,
            title: attributes.author,
          }
        },
      },
      comment: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment'),
        renderHTML: (attributes) => {
          if (attributes.comment == null) return {}
          return { 'data-comment': attributes.comment }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-comment][data-author]',
        getAttrs: (node) => ({
          author: node.getAttribute('data-author'),
          comment: node.getAttribute('data-comment'),
        }),
      },
    ]
  },

  renderHTML({ mark, HTMLAttributes }) {
    const author = mark.attrs?.author ?? HTMLAttributes['data-author']
    const colorIdx = getAuthorColorIndex(String(author || ''))
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'legal-comment',
        'data-author-color': String(colorIdx),
      }),
      0,
    ]
  },
})
