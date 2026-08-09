import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Mapping, ReplaceStep } from '@tiptap/pm/transform'
import { getAuthorColorIndex } from './authorColors.js'

const TRACKED_BLOCK_TYPES = new Set(['paragraph', 'heading', 'listItem', 'blockquote'])

export const TrackChangesExtension = Extension.create({
  name: 'trackChanges',
  priority: 1000,

  addOptions() {
    return {
      enabled: false,
      currentUserName: 'Unknown',
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'listItem', 'blockquote'],
        attributes: {
          blockChange: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => {
              const insAuthor = element.getAttribute('data-block-inserted')
              if (insAuthor) return { type: 'insertion', author: insAuthor }
              const delAuthor = element.getAttribute('data-block-deleted')
              if (delAuthor) return { type: 'deletion', author: delAuthor }
              return null
            },
            renderHTML: (attributes) => {
              const bc = attributes.blockChange
              if (!bc || !bc.type) return {}
              const colorIdx = getAuthorColorIndex(String(bc.author || ''))
              if (bc.type === 'deletion') {
                return { 'data-block-deleted': bc.author, 'data-author-color': String(colorIdx) }
              }
              return { 'data-block-inserted': bc.author, 'data-author-color': String(colorIdx) }
            },
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    const extension = this

    return [
      new Plugin({
        key: new PluginKey('trackChanges'),
        appendTransaction(transactions, _oldState, newState) {
          if (!extension.options.enabled) return null
          if (
            transactions.some(
              (trx) =>
                trx.getMeta('skipTrackChanges') ||
                trx.getMeta('history$') ||
                trx.getMeta('y-sync$') ||
                trx.getMeta('y-undo$'),
            )
          ) {
            return null
          }
          if (!transactions.some((trx) => trx.docChanged)) return null

          const schema = newState.schema
          const insertionMark = schema.marks.insertion
          const deletionMark = schema.marks.deletion
          if (!insertionMark || !deletionMark) return null

          const author = extension.options.currentUserName
          const insertion = insertionMark.create({ author, comment: null })
          const deletion = deletionMark.create({ author, comment: null })

          const stepMaps = transactions.flatMap((trx) => trx.steps.map((step) => step.getMap()))
          let mapIndex = 0
          const ops = []

          for (const trx of transactions) {
            trx.steps.forEach((step, i) => {
              const currentMapIndex = mapIndex++
              if (!(step instanceof ReplaceStep)) return

              let localFrom = null
              let localTo = null
              step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
                localFrom = localFrom === null ? newStart : Math.min(localFrom, newStart)
                localTo = localTo === null ? newEnd : Math.max(localTo, newEnd)
              })

              const docBefore = trx.docs[i]
              const removedText =
                step.to > step.from ? docBefore.textBetween(step.from, step.to, '\n', '') : ''

              if (
                (localFrom === null || localTo === null || localTo === localFrom) &&
                !removedText
              ) {
                return
              }

              const after = new Mapping(stepMaps.slice(currentMapIndex + 1))
              const insertedFrom = after.map(localFrom ?? step.from, -1)
              const insertedTo = after.map(localTo ?? step.from, 1)
              ops.push({ pos: insertedFrom, removedText, insertedFrom, insertedTo })
            })
          }

          if (ops.length === 0) return null

          const blockInserts = new Set()
          for (const op of ops) {
            if (op.insertedTo <= op.insertedFrom) continue
            newState.doc.nodesBetween(op.insertedFrom, op.insertedTo, (node, pos) => {
              if (node.isText) return
              if (!TRACKED_BLOCK_TYPES.has(node.type.name)) return
              if (pos < op.insertedFrom) return
              const existing = node.attrs?.blockChange
              if (existing?.type) return
              blockInserts.add(pos)
            })
          }

          const tr = newState.tr

          for (const pos of [...blockInserts].sort((a, b) => b - a)) {
            const node = tr.doc.nodeAt(pos)
            if (!node) continue
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              blockChange: { type: 'insertion', author },
            })
          }

          for (const op of [...ops].sort((a, b) => b.pos - a.pos)) {
            if (op.removedText) {
              tr.insertText(op.removedText, op.pos)
              tr.removeMark(op.pos, op.pos + op.removedText.length, insertionMark)
              tr.addMark(op.pos, op.pos + op.removedText.length, deletion)
            }
            const insFrom = op.pos + op.removedText.length
            const insTo = insFrom + (op.insertedTo - op.insertedFrom)
            if (insTo > insFrom) {
              tr.removeMark(insFrom, insTo, deletionMark)
              tr.addMark(insFrom, insTo, insertion)
            }
          }

          if (!tr.docChanged && tr.steps.length === 0) return null
          tr.setMeta('skipTrackChanges', true)
          return tr
        },
      }),
    ]
  },

  addCommands() {
    const ext = this
    return {
      acceptChange:
        () =>
        ({ state, dispatch }) => {
          const insertionMark = state.schema.marks.insertion
          const deletionMark = state.schema.marks.deletion
          if (!insertionMark || !deletionMark || !dispatch) return false
          const { from, to } = state.selection
          const hasInsertion = state.doc.rangeHasMark(from, to, insertionMark)
          const hasDeletion = state.doc.rangeHasMark(from, to, deletionMark)
          if (hasInsertion) {
            const chain = ext.editor.chain().focus()
            if (from === to) chain.extendMarkRange('insertion')
            return chain.unsetMark('insertion').run()
          }
          if (hasDeletion) {
            let rangeFrom = from
            let rangeTo = to
            if (from === to) {
              state.doc.nodesBetween(
                Math.max(0, from - 1000),
                Math.min(state.doc.content.size, to + 1000),
                (node, pos) => {
                  if (
                    pos <= from &&
                    pos + node.nodeSize >= from &&
                    node.marks.some((m) => m.type === deletionMark)
                  ) {
                    rangeFrom = pos
                    rangeTo = pos + node.nodeSize
                  }
                },
              )
            }
            const tr = state.tr.delete(rangeFrom, rangeTo)
            dispatch(tr)
            return true
          }
          return false
        },

      acceptAllChanges:
        () =>
        ({ state, dispatch }) => {
          const insertionMark = state.schema.marks.insertion
          const deletionMark = state.schema.marks.deletion
          if (!insertionMark || !deletionMark || !dispatch) return false

          const deletionRanges = []
          const blockClears = []
          let tr = state.tr

          state.doc.descendants((node, pos) => {
            const blockChange = node.attrs?.blockChange
            if (blockChange?.type) {
              blockClears.push(pos)
            }
            if (!node.isText) return
            const hasInsertion = node.marks.some((m) => m.type === insertionMark)
            const hasDeletion = node.marks.some((m) => m.type === deletionMark)

            if (hasInsertion) {
              tr = tr.removeMark(pos, pos + node.nodeSize, insertionMark)
            }
            if (hasDeletion) {
              deletionRanges.push({ from: pos, to: pos + node.nodeSize })
            }
          })

          for (const pos of blockClears) {
            const node = tr.doc.nodeAt(pos)
            if (node) {
              tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockChange: null })
            }
          }

          for (let i = deletionRanges.length - 1; i >= 0; i--) {
            tr = tr.delete(deletionRanges[i].from, deletionRanges[i].to)
          }

          if (!tr.docChanged) return false
          tr.setMeta('skipTrackChanges', true)
          dispatch(tr)
          return true
        },
    }
  },

  addKeyboardShortcuts() {
    const markSelectionDeleted = () => {
      if (!this.options.enabled) return false
      const { state } = this.editor
      const { from, to } = state.selection
      if (from === to) return false
      return this.editor
        .chain()
        .focus()
        .setMark('deletion', {
          author: this.options.currentUserName,
          comment: null,
        })
        .run()
    }

    return {
      Backspace: markSelectionDeleted,
      Delete: markSelectionDeleted,
    }
  },
})
