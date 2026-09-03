/**
 * ContractEditor — a self-contained, framework-neutral TipTap (v3) rich-text editor for
 * legal contract documents. Brings its own toolbar UI (plain buttons, no CoreUI/shadcn),
 * .docx import/export, PDF export, tables + cell shading, page layout, and page guides —
 * so it can be shared unchanged between apps with different UI kits.
 */

import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import classNames from 'classnames'
import { Extension } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { Tiptap, useEditor, useTiptap, useTiptapState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import Strike from '@tiptap/extension-strike'
import { TableRow } from '@tiptap/extension-table'
import { TextStyle, FontFamily, FontSize, Color } from '@tiptap/extension-text-style'
// Track-changes (redline) engine — enabled only in review mode.
import { InsertionMark, DeletionMark } from './extensions/trackChangeMarks.js'
import { CommentMark } from './extensions/CommentMark.js'
import { TrackChangesExtension } from './extensions/TrackChangesExtension.js'
import {
  canCommentOnSelection,
  requestCommentOnSelection,
} from './extensions/changeCommentEditor.js'
import CommentMargin from './extensions/CommentMargin.jsx'
import { LegalTableCell, LegalTableHeader } from './extensions/legalTableCell.js'
import LegalTable, { refitTablesToPrintableWidth } from './extensions/legalTable.js'
import PageLayoutPanel, { buildLayoutVars } from './extensions/PageLayoutPanel.jsx'
import TablePropertiesPanel from './extensions/TablePropertiesPanel.jsx'
import { parsePageSetupMarker, withPageSetupMarker } from './extensions/pageSetupMarker.js'
import { TokenHighlight } from './extensions/tokenHighlight.js'
import { ConditionalText } from './extensions/conditionalText.js'
import { RepeatBlock } from './extensions/repeatBlock.js'
import { PlaceholderSuggestion } from './extensions/placeholderSuggestion.js'
import {
  LegalDocumentImage,
  isLegalContentAlignActive,
  serializeLegalDocumentEditorHtml,
  setLegalContentAlign,
} from './extensions/legalDocumentImage.js'
import { getRichTextPlainText } from './extensions/richText.js'
import './extensions/tiptap-styles.css'
import './contract-editor.scss'

/** Framework-neutral inline spinner (replaces the host app's UI-kit spinner). */
const Spinner = () => <span className="contract-editor__spinner" aria-hidden="true" />

/**
 * Replace the editor's whole content. In review mode (skipTracking) the replacement is
 * dispatched with a `skipTrackChanges` meta so the track-changes engine does NOT record the
 * programmatic content set (external sync / .docx import) as one giant insertion. In template
 * mode it's an ordinary setContent.
 */
/** TipTap nulls `commandManager` on destroy; `isDestroyed` alone is not enough
 *  under StrictMode remounts — accessing `.commands` then throws and takes the
 *  host page down (tax certificate Edit is the usual path).
 *  Also treat the internal `destroyed` flag (set at the start of `destroy()`)
 *  as authoritative: `isDestroyed` only mirrors `editorView`, which can lag. */
const editorCanCommand = (editor) =>
  Boolean(
    editor &&
      !editor.destroyed &&
      !editor.isDestroyed &&
      editor.commandManager,
  )

const applyEditorContent = (editor, html, { skipTracking = false, emitUpdate = false } = {}) => {
  if (!editorCanCommand(editor)) return
  const safeHtml = html || '<p></p>'
  if (!skipTracking) {
    editor.commands.setContent(safeHtml, { emitUpdate })
    return
  }
  const { state, view } = editor
  const wrapper = window.document.createElement('div')
  wrapper.innerHTML = safeHtml
  try {
    const parsed = PMDOMParser.fromSchema(state.schema).parse(wrapper, {
      preserveWhitespace: 'full',
    })
    view.dispatch(
      state.tr
        .replaceWith(0, state.doc.content.size, parsed.content)
        .setMeta('skipTrackChanges', true),
    )
  } catch (err) {
    console.error('applyEditorContent (skipTracking) failed, falling back:', err)
    editor.commands.setContent(safeHtml, { emitUpdate })
  }
}

const DEFAULT_LABELS = {
  words: 'words',
  characters: 'characters',
  addComment: 'Add comment',
  addCommentNeedsSelection: 'Select the text you want to comment on first',
  changeWithAI: 'Change with AI',
  insertTable: 'Insert table',
  addColumnBefore: 'Add column before',
  addColumnAfter: 'Add column after',
  deleteColumn: 'Delete column',
  addRowBefore: 'Add row before',
  addRowAfter: 'Add row after',
  deleteRow: 'Delete row',
  deleteTable: 'Delete table',
  file: 'File',
  importDocx: 'Import .docx',
  exportDocx: 'Export .docx',
  exportDocxTracked: 'Export .docx (tracked)',
  exportDocxTrackedHint: 'Export with tracked changes and comments visible in Word',
  exportPdf: 'Export PDF',
  importing: 'Importing…',
  exporting: 'Exporting…',
  importError: 'Could not import this .docx file.',
  exportError: 'Could not export to .docx.',
  exportPdfError: 'Could not export to PDF.',
  enterFullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomReset: 'Reset zoom to 100%',
  pageGuides: 'Page guides',
  pageGuidesHint:
    'Show where each printed page ends. A document shorter than one page has no break to show.',
  layout: 'Page & layout',
  pageSize: 'Page size',
  preset: 'Format',
  presetA4: 'A4 (210 × 297 mm)',
  presetLetter: 'Letter (216 × 279 mm)',
  presetLegal: 'Legal (216 × 356 mm)',
  presetCustom: 'Custom',
  width: 'Width',
  height: 'Height',
  margins: 'Margins',
  marginTop: 'Top',
  marginBottom: 'Bottom',
  marginLeft: 'Left',
  marginRight: 'Right',
  tableProperties: 'Table size (current table)',
  tableWidth: 'Table width',
  cellPadY: 'Cell padding (vertical)',
  cellPadX: 'Cell padding (horizontal)',
  rowHeight: 'Row height',
  resetLayout: 'Reset to A4',
  resetTable: 'Reset table',
  // In-editor comment margin (review mode).
  removed: 'Removed',
  added: 'Added',
  selectedText: 'Selected text',
  accept: 'Accept',
  reject: 'Reject',
  revert: 'Revert',
  resolve: 'Resolve',
  reopen: 'Reopen discussion',
  reply: 'Reply',
  edit: 'Edit',
  save: 'Save',
  cancel: 'Cancel',
  commentPlaceholder: 'Write your comment…',
  resolved: 'Resolved',
  lawyer: 'Lawyer',
  lawyerRejected: 'Lawyer rejected',
  lawyerReason: "Lawyer's reason",
}

const ToolbarButton = ({ active, disabled, onClick, children, title }) => (
  <button
    type="button"
    className={classNames('rich-text-editor__toolbar-btn', {
      'rich-text-editor__toolbar-btn--active': active,
    })}
    disabled={disabled}
    onClick={onClick}
    title={title}
    aria-pressed={active}
  >
    {children}
  </button>
)

ToolbarButton.propTypes = {
  active: PropTypes.bool,
  disabled: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
  title: PropTypes.string,
}

/**
 * A toolbar button that opens a small menu of actions. Used to demote the rarely-used
 * file commands (import/export) from four permanent buttons to one, which is most of what
 * kept the document-actions bar wrapping onto a second row.
 *
 * Deliberately hand-rolled rather than pulled from a UI kit: this module ships into apps on
 * CoreUI and on shadcn, and taking a dependency on either is exactly the coupling it exists
 * to avoid. Same pattern as PageLayoutPanel's popover — close on outside click and Escape.
 */
const ToolbarMenu = ({ label, title, children }) => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.document.addEventListener('mousedown', onPointerDown)
    window.document.addEventListener('keydown', onKeyDown)
    return () => {
      window.document.removeEventListener('mousedown', onPointerDown)
      window.document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="legal-template-editor__menu" ref={rootRef}>
      <button
        type="button"
        className={classNames('rich-text-editor__toolbar-btn', {
          'rich-text-editor__toolbar-btn--active': open,
        })}
        aria-expanded={open}
        aria-haspopup="menu"
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <span className="legal-template-editor__menu-caret" aria-hidden="true" />
      </button>
      {open ? (
        // Clicking any action closes the menu — every entry here is a one-shot command.
        <div className="legal-template-editor__menu-panel" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  )
}

ToolbarMenu.propTypes = {
  label: PropTypes.node.isRequired,
  title: PropTypes.string,
  children: PropTypes.node.isRequired,
}

const ToolbarMenuItem = ({ disabled, onClick, title, children }) => (
  <button
    type="button"
    role="menuitem"
    className="legal-template-editor__menu-item"
    disabled={disabled}
    onClick={onClick}
    title={title}
  >
    {children}
  </button>
)

ToolbarMenuItem.propTypes = {
  disabled: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  title: PropTypes.string,
  children: PropTypes.node.isRequired,
}

// `ctx.editor` can be null on the selector's final invocation during teardown
// (e.g. the editor is destroyed while this toolbar hasn't unmounted yet) —
// without this guard that transient null crashes the whole tree.
const EMPTY_TOOLBAR_STATE = {
  isBold: false,
  isItalic: false,
  isUnderline: false,
  isStrike: false,
  isCode: false,
  isHighlight: false,
  isHeading1: false,
  isHeading2: false,
  isHeading3: false,
  isBulletList: false,
  isOrderedList: false,
  isBlockquote: false,
  isTable: false,
  tableAttrs: {},
  isLink: false,
  isAlignLeft: false,
  isAlignCenter: false,
  isAlignRight: false,
  canUndo: false,
  canRedo: false,
  canComment: false,
}

const selectToolbarState = (ctx) => {
  // A DESTROYED editor is not a null editor: `useEditorState` can run this
  // selector once more after the instance has been torn down (a consumer
  // remounting the editor via `key`, or unmounting it while the toolbar is
  // still subscribed). The object is still there, but `commandManager` is
  // already null, so `editor.can()` / `.commands` throws and takes the whole
  // React root down. Treat destroyed exactly like absent.
  if (!editorCanCommand(ctx.editor)) return EMPTY_TOOLBAR_STATE
  return {
    isBold: ctx.editor.isActive('bold'),
    isItalic: ctx.editor.isActive('italic'),
    isUnderline: ctx.editor.isActive('underline'),
    isStrike: ctx.editor.isActive('strike'),
    isCode: ctx.editor.isActive('code'),
    isHighlight: ctx.editor.isActive('highlight'),
    isHeading1: ctx.editor.isActive('heading', { level: 1 }),
    isHeading2: ctx.editor.isActive('heading', { level: 2 }),
    isHeading3: ctx.editor.isActive('heading', { level: 3 }),
    isBulletList: ctx.editor.isActive('bulletList'),
    isOrderedList: ctx.editor.isActive('orderedList'),
    isBlockquote: ctx.editor.isActive('blockquote'),
    isTable: ctx.editor.isActive('table'),
    tableAttrs: ctx.editor.getAttributes('table'),
    isLink: ctx.editor.isActive('link'),
    isAlignLeft: isLegalContentAlignActive(ctx.editor, 'left'),
    isAlignCenter: isLegalContentAlignActive(ctx.editor, 'center'),
    isAlignRight: isLegalContentAlignActive(ctx.editor, 'right'),
    canUndo: ctx.editor.can().chain().focus().undo().run(),
    canRedo: ctx.editor.can().chain().focus().redo().run(),
    // Drives the "Add comment" button's enabled state — see canCommentOnSelection.
    canComment: canCommentOnSelection(ctx.editor),
  }
}

const useEditorCommands = () => {
  const { editor } = useTiptap()

  const setLink = () => {
    if (!editorCanCommand(editor)) return
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('Enter URL', previousUrl || 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  const addImage = () => {
    if (!editorCanCommand(editor)) return
    const url = window.prompt('Enter image URL')
    if (url) {
      editor.chain().focus().setImage({ src: url }).run()
    }
  }

  return { editor, setLink, addImage }
}

const FormattingGroup = ({ state, editor }) => (
  <div className="rich-text-editor__toolbar-group">
    <ToolbarButton
      title="Bold"
      active={state.isBold}
      onClick={() => editor.chain().focus().toggleBold().run()}
    >
      <strong>B</strong>
    </ToolbarButton>
    <ToolbarButton
      title="Italic"
      active={state.isItalic}
      onClick={() => editor.chain().focus().toggleItalic().run()}
    >
      <em>I</em>
    </ToolbarButton>
    <ToolbarButton
      title="Underline"
      active={state.isUnderline}
      onClick={() => editor.chain().focus().toggleUnderline().run()}
    >
      <span style={{ textDecoration: 'underline' }}>U</span>
    </ToolbarButton>
    <ToolbarButton
      title="Strikethrough"
      active={state.isStrike}
      onClick={() => editor.chain().focus().toggleStrike().run()}
    >
      <s>S</s>
    </ToolbarButton>
    <ToolbarButton
      title="Inline code"
      active={state.isCode}
      onClick={() => editor.chain().focus().toggleCode().run()}
    >
      {'<>'}
    </ToolbarButton>
  </div>
)

FormattingGroup.propTypes = {
  state: PropTypes.object.isRequired,
  editor: PropTypes.object.isRequired,
}

const TipTapMenuBar = ({
  labels,
  onComment,
  onImageRequest,
  onChangeWithAI,
  commentOnly,
  insertExtras,
}) => {
  const { editor, setLink, addImage } = useEditorCommands()
  const state = useTiptapState(selectToolbarState)

  if (!editorCanCommand(editor)) return null

  // Review "comment only" stage: no formatting tools, just commenting + undo/redo.
  if (commentOnly) {
    return (
      <div className="rich-text-editor__toolbar" role="toolbar" aria-label="Comments">
        {onComment ? (
          <div className="rich-text-editor__toolbar-group">
            <ToolbarButton
              title={state.canComment ? labels.addComment : labels.addCommentNeedsSelection}
              disabled={!state.canComment}
              onClick={onComment}
            >
              <span className="rich-text-editor__icon-comment" aria-hidden="true" />
            </ToolbarButton>
          </div>
        ) : null}
        <div className="rich-text-editor__toolbar-group">
          <ToolbarButton
            title="Undo"
            disabled={!state.canUndo}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <span className="rich-text-editor__icon-undo" aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            title="Redo"
            disabled={!state.canRedo}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <span className="rich-text-editor__icon-redo" aria-hidden="true" />
          </ToolbarButton>
        </div>
      </div>
    )
  }

  return (
    <div className="rich-text-editor__toolbar" role="toolbar" aria-label="Text formatting">
      <FormattingGroup state={state} editor={editor} />

      <div className="rich-text-editor__toolbar-group">
        <ToolbarButton
          title="Heading 1"
          active={state.isHeading1}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          H1
        </ToolbarButton>
        <ToolbarButton
          title="Heading 2"
          active={state.isHeading2}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </ToolbarButton>
        <ToolbarButton
          title="Heading 3"
          active={state.isHeading3}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          H3
        </ToolbarButton>
      </div>

      <div className="rich-text-editor__toolbar-group">
        <ToolbarButton
          title="Bullet list"
          active={state.isBulletList}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <span className="rich-text-editor__icon-list" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          title="Numbered list"
          active={state.isOrderedList}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <span className="rich-text-editor__icon-olist" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          title="Indent clause (nest as 1.1, 1.1.1 …)"
          disabled={!state.isBulletList && !state.isOrderedList}
          onClick={() => editor.chain().focus().sinkListItem('listItem').run()}
        >
          <span className="rich-text-editor__icon-indent" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          title="Outdent clause"
          disabled={!state.isBulletList && !state.isOrderedList}
          onClick={() => editor.chain().focus().liftListItem('listItem').run()}
        >
          <span className="rich-text-editor__icon-outdent" aria-hidden="true" />
        </ToolbarButton>
      </div>

      <div className="rich-text-editor__toolbar-group">
        <ToolbarButton
          title="Blockquote"
          active={state.isBlockquote}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          &ldquo;
        </ToolbarButton>
        <ToolbarButton
          title="Horizontal rule"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          &mdash;
        </ToolbarButton>
      </div>

      <div className="rich-text-editor__toolbar-group">
        <ToolbarButton
          title="Insert image"
          onClick={onImageRequest ? () => onImageRequest(editor) : addImage}
        >
          <span className="rich-text-editor__icon-image" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton title="Insert link" active={state.isLink} onClick={setLink}>
          <span className="rich-text-editor__icon-link" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          title="Highlight"
          active={state.isHighlight}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
        >
          <span className="rich-text-editor__icon-highlight" aria-hidden="true" />
        </ToolbarButton>
      </div>

      <div className="rich-text-editor__toolbar-group">
        <ToolbarButton
          title={labels.insertTable}
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        >
          <span className="rich-text-editor__icon-table" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          title={labels.addColumnBefore}
          disabled={!state.isTable}
          onClick={() => editor.chain().focus().addColumnBefore().run()}
        >
          <span className="rich-text-editor__icon-col-before" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          title={labels.addColumnAfter}
          disabled={!state.isTable}
          onClick={() => editor.chain().focus().addColumnAfter().run()}
        >
          <span className="rich-text-editor__icon-col-after" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          title={labels.deleteColumn}
          disabled={!state.isTable}
          onClick={() => editor.chain().focus().deleteColumn().run()}
        >
          <span className="rich-text-editor__icon-col-delete" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          title={labels.addRowBefore}
          disabled={!state.isTable}
          onClick={() => editor.chain().focus().addRowBefore().run()}
        >
          <span className="rich-text-editor__icon-row-before" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          title={labels.addRowAfter}
          disabled={!state.isTable}
          onClick={() => editor.chain().focus().addRowAfter().run()}
        >
          <span className="rich-text-editor__icon-row-after" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          title={labels.deleteRow}
          disabled={!state.isTable}
          onClick={() => editor.chain().focus().deleteRow().run()}
        >
          <span className="rich-text-editor__icon-row-delete" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          title={labels.deleteTable}
          disabled={!state.isTable}
          onClick={() => editor.chain().focus().deleteTable().run()}
        >
          <span className="rich-text-editor__icon-table-delete" aria-hidden="true" />
        </ToolbarButton>
      </div>

      <TablePropertiesPanel
        labels={labels}
        editor={editor}
        disabled={!state.isTable}
        attrs={state.tableAttrs}
      />

      <div className="rich-text-editor__toolbar-group">
        <ToolbarButton
          title="Align left"
          active={state.isAlignLeft}
          onClick={() => setLegalContentAlign(editor, 'left')}
        >
          <span className="rich-text-editor__icon-align-left" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          title="Align center"
          active={state.isAlignCenter}
          onClick={() => setLegalContentAlign(editor, 'center')}
        >
          <span className="rich-text-editor__icon-align-center" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          title="Align right"
          active={state.isAlignRight}
          onClick={() => setLegalContentAlign(editor, 'right')}
        >
          <span className="rich-text-editor__icon-align-right" aria-hidden="true" />
        </ToolbarButton>
      </div>

      {insertExtras ? (
        // Host-supplied insert tools (merge-field placeholders, signature anchors). They sit
        // with image/link/table because they are the same kind of action — put something at
        // the cursor — rather than in the document-actions bar above.
        <div className="legal-template-editor__insert-extras">{insertExtras}</div>
      ) : null}
      {onComment || onChangeWithAI ? (
        <div className="rich-text-editor__toolbar-group">
          {onComment ? (
            <ToolbarButton
              title={state.canComment ? labels.addComment : labels.addCommentNeedsSelection}
              disabled={!state.canComment}
              onClick={onComment}
            >
              <span className="rich-text-editor__icon-comment" aria-hidden="true" />
            </ToolbarButton>
          ) : null}
          {onChangeWithAI ? (
            <ToolbarButton title={labels.changeWithAI} onClick={onChangeWithAI}>
              ✨
            </ToolbarButton>
          ) : null}
        </div>
      ) : null}

      <div className="rich-text-editor__toolbar-group">
        <ToolbarButton
          title="Undo"
          disabled={!state.canUndo}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <span className="rich-text-editor__icon-undo" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          title="Redo"
          disabled={!state.canRedo}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <span className="rich-text-editor__icon-redo" aria-hidden="true" />
        </ToolbarButton>
      </div>
    </div>
  )
}

TipTapMenuBar.propTypes = {
  labels: PropTypes.object.isRequired,
  onComment: PropTypes.func,
  onImageRequest: PropTypes.func,
  onChangeWithAI: PropTypes.func,
  commentOnly: PropTypes.bool,
  insertExtras: PropTypes.node,
}

/**
 * @param {{ selectionExtras?: unknown }} props host tools shown on selection —
 *   the natural home for anything that acts ON the selected words, since the
 *   menu is already under the cursor when the author has just made one.
 */
const TipTapBubbleMenu = ({ selectionExtras }) => {
  const { editor, setLink } = useEditorCommands()
  const state = useTiptapState(selectToolbarState)

  if (!editorCanCommand(editor)) return null

  return (
    <BubbleMenu
      className="rich-text-editor__bubble-menu"
      editor={editor}
      tippyOptions={{ duration: 100 }}
    >
      <FormattingGroup state={state} editor={editor} />
      <div className="rich-text-editor__toolbar-group">
        <ToolbarButton title="Insert link" active={state.isLink} onClick={setLink}>
          <span className="rich-text-editor__icon-link" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          title="Highlight"
          active={state.isHighlight}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
        >
          <span className="rich-text-editor__icon-highlight" aria-hidden="true" />
        </ToolbarButton>
      </div>
      {selectionExtras ? <div className="rich-text-editor__toolbar-group">{selectionExtras}</div> : null}
    </BubbleMenu>
  )
}

// Tab / Shift-Tab nests or un-nests the current clause (list item) — the natural way a
// lawyer builds "1., 1.1., 1.1.1." numbering, matching Word/Google Docs behavior. Falls
// through to default Tab behavior (e.g. moving focus) when not inside a list.
const LegalListNesting = Extension.create({
  name: 'legalListNesting',
  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.sinkListItem('listItem'),
      'Shift-Tab': () => this.editor.commands.liftListItem('listItem'),
    }
  },
})

/**
 * @param {string} placeholder
 * @param {{ enabled?: boolean, currentUserName?: string }} [trackChanges] - when enabled,
 *   the redline engine is added: StarterKit's strike is turned off (so `<del>` is reserved
 *   for tracked deletions) and re-added for `<s>`/`<strike>` only, plus the insertion /
 *   deletion / comment marks and the TrackChangesExtension. Off (template mode) → plain edit.
 */
const buildExtensions = (placeholder, trackChanges, placeholderSuggestion, knownTokens) => {
  const redline = Boolean(trackChanges?.enabled)
  return [
    // StarterKit (v3.28) now bundles Link + Underline. We register our own configured
    // versions below, so disable StarterKit's — two extensions with the same mark name
    // corrupt the schema and crash setContent with "other.mark.eq is not a function".
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      underline: false,
      ...(redline ? { strike: false } : {}),
    }),
    ...(redline
      ? [
          Strike.extend({
            parseHTML() {
              return [{ tag: 's' }, { tag: 'strike' }]
            },
          }),
        ]
      : []),
    Placeholder.configure({
      placeholder: placeholder || 'Start typing your content...',
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    }),
    Underline,
    // Inline style marks so Word's per-run font/size/color survive import → edit → export.
    TextStyle,
    FontFamily,
    FontSize,
    Color,
    LegalDocumentImage,
    TextAlign.configure({
      types: ['heading', 'paragraph'],
      alignments: ['left', 'center', 'right', 'justify'],
    }),
    Highlight.configure({
      multicolor: false,
    }),
    LegalTable.configure({ resizable: true }),
    TableRow,
    LegalTableHeader,
    LegalTableCell,
    LegalListNesting,
    // Display-only, so it applies in template and redline mode alike: it tints
    // `{{…}}` tokens in the view and never touches the stored HTML.
    TokenHighlight.configure({ knownTokens: knownTokens ?? null }),
    // Stored markup, unlike TokenHighlight: the backend reads these spans to
    // decide whether the text inside belongs in a given tenant's document.
    ConditionalText,
    // Same bargain one level up — a block the assembler COPIES, once per
    // selected answer. A node, not a mark: the content is duplicated whole.
    RepeatBlock,
    ...(placeholderSuggestion ? [PlaceholderSuggestion.configure(placeholderSuggestion)] : []),
    ...(redline
      ? [
          InsertionMark,
          DeletionMark,
          CommentMark,
          TrackChangesExtension.configure({
            enabled: true,
            currentUserName: trackChanges.currentUserName || 'Unknown',
          }),
        ]
      : []),
  ]
}

const countWords = (text) => {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

// Floor is well below 100% (not just 50%) because the whole point of zoom is letting the
// author see a too-wide table (or a page widened by the layout tool) without it bleeding into
// the review comment margin next to the page — that margin column has a fixed screen width,
// independent of zoom, so a table has to shrink a lot further than "a bit too wide" sometimes
// implies before it clears that column. Matches the range Word/Docs give (roughly 25%–200%).
const AUTO_FIT_MIN_DELTA = 0.02 // ignore trivially small corrections (rounding, scrollbar jitter)
const ZOOM_MIN = 0.25
const ZOOM_MAX = 2
const ZOOM_STEP = 0.1
const clampZoom = (value) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100))

/**
 * Import/export the whole document as a real .docx file. Kept separate from the main
 * toolbar since it needs its own async/loading state and operates on the editor as a
 * whole (not the current selection).
 */
const DocumentActionsBar = ({
  editor,
  labels,
  onError,
  isFullscreen,
  onToggleFullscreen,
  pageGuides,
  onTogglePageGuides,
  pageSetup,
  onPageSetup,
  skipTracking,
  reviewMode,
  currentUserName,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onContentReplaced,
  toolbarExtras,
  titleSlot,
  onExportPdf,
}) => {
  const fileInputRef = useRef(null)
  const [isImporting, setIsImporting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const handleImportClick = () => {
    if (!isImporting) fileInputRef.current?.click()
  }

  const handleFileSelected = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = '' // allow re-selecting the same file next time
    if (!file || !editor) return

    setIsImporting(true)
    try {
      const { importDocxToHtml } = await import('./extensions/docxImport.js')
      // In review mode, bring Word's tracked changes + comments back in AS tracked marks so
      // the redline continues; in template mode, import the clean accepted base document.
      const {
        html,
        warnings,
        pageSetup: importedPage,
      } = await importDocxToHtml(file, {
        trackedChanges: reviewMode,
      })

      let finalHtml = html
      // Auto-compare: if the Word file carried NO tracked changes but we're reviewing, diff the
      // imported content against the current document and surface the edits as redline — so a
      // doc edited in Word without Track Changes on still comes back as reviewable changes.
      if (reviewMode && !/<(ins|del)\b/i.test(html)) {
        const { diffHtmlToRedline } = await import('./extensions/redlineDiff.js')
        const baseHtml = parsePageSetupMarker(serializeLegalDocumentEditorHtml(editor)).html
        finalHtml = diffHtmlToRedline(baseHtml, html, currentUserName || 'Reviewer')
      }

      applyEditorContent(editor, finalHtml, { skipTracking })
      onPageSetup?.(importedPage || null)
      // A freshly imported table can carry raw, unrescaled column widths wider than this
      // page — re-check whether the current zoom still keeps it clear of the comment margin.
      onContentReplaced?.()
      if (warnings.length) {
        console.warn('[docx import]', warnings)
      }
    } catch (error) {
      onError?.(labels.importError, error)
    } finally {
      setIsImporting(false)
    }
  }

  const handleExport = async (tracked = false) => {
    if (!editor) return
    setIsExporting(true)
    try {
      // docx is a sizeable dependency — load it only when Export is actually used.
      const { exportHtmlToDocx } = await import('./extensions/docxExport.js')
      await exportHtmlToDocx(serializeLegalDocumentEditorHtml(editor), {
        fileName: tracked ? 'contract-tracked.docx' : 'contract.docx',
        pageSetup, // reproduce the imported source's page size + margins
        trackedChanges: tracked, // emit native Word revisions + comments when requested
      })
    } catch (error) {
      onError?.(labels.exportError, error)
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportPdf = async () => {
    if (!editor) return
    try {
      const { exportHtmlToPdf } = await import('./extensions/pdfExport.js')
      exportHtmlToPdf(serializeLegalDocumentEditorHtml(editor), { title: 'Contract', pageSetup })
    } catch (error) {
      onError?.(labels.exportPdfError, error)
    }
  }

  return (
    <div className="legal-template-editor__doc-actions">
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />
      {/* File commands are used once or twice a session, so they live behind one menu
          instead of four always-on buttons. */}
      <ToolbarMenu
        label={isImporting ? labels.importing : isExporting ? labels.exporting : labels.file}
        title={labels.file}
      >
        <ToolbarMenuItem disabled={isImporting} onClick={handleImportClick}>
          {labels.importDocx}
        </ToolbarMenuItem>
        <ToolbarMenuItem disabled={isExporting} onClick={() => handleExport(false)}>
          {labels.exportDocx}
        </ToolbarMenuItem>
        {reviewMode ? (
          <ToolbarMenuItem
            disabled={isExporting}
            onClick={() => handleExport(true)}
            title={labels.exportDocxTrackedHint}
          >
            {labels.exportDocxTracked}
          </ToolbarMenuItem>
        ) : null}
        {/* A host that renders PDFs server-side passes onExportPdf so export and the
            published file come from ONE renderer; otherwise this falls back to the
            built-in browser-print export, which keeps the module usable standalone. */}
        <ToolbarMenuItem onClick={onExportPdf || handleExportPdf}>
          {labels.exportPdf}
        </ToolbarMenuItem>
      </ToolbarMenu>
      {titleSlot ? (
        // Optional inline document title, right after File. Optional because it only makes
        // sense where the editor IS the page (a contract has one title, edited here); a host
        // that embeds the editor as one field among many keeps its own form field instead
        // and simply passes nothing.
        <div className="legal-template-editor__title-slot">{titleSlot}</div>
      ) : null}
      <div className="legal-template-editor__doc-actions-spacer" />
      {toolbarExtras ? (
        <div className="legal-template-editor__toolbar-extras">{toolbarExtras}</div>
      ) : null}
      {/* Everything from here right is one "view" cluster — controls that change how the
          document is DISPLAYED (page geometry, page-break guides, fullscreen, zoom), in
          escalating scope. Keeping them adjacent is what makes the bar read as zones:
          document identity on the left, host workflow in the middle, view at the end —
          instead of view controls scattered through the bar. */}
      {/* Page & layout is deliberately NOT inside a bordered toolbar-group: the group's
          `overflow: hidden` (which clips its children's corners) would also clip the
          popover this trigger opens — the panel renders but is invisible. */}
      <PageLayoutPanel labels={labels} pageSetup={pageSetup} onPageSetup={onPageSetup} />
      {/* Icon-only, like its neighbours — the active highlight carries the on/off state
          and the tooltip carries the name and the "shorter than one page" caveat. */}
      <ToolbarButton
        title={labels.pageGuidesHint}
        active={pageGuides}
        onClick={onTogglePageGuides}
      >
        <span className="rich-text-editor__icon-page-guides" aria-hidden="true" />
      </ToolbarButton>
      <div className="rich-text-editor__toolbar-group legal-template-editor__zoom">
        <ToolbarButton
          title={labels.zoomOut}
          disabled={zoom <= ZOOM_MIN}
          onClick={onZoomOut}
        >
          <span className="rich-text-editor__icon-zoom-out" aria-hidden="true" />
        </ToolbarButton>
        <button
          type="button"
          className="rich-text-editor__toolbar-btn legal-template-editor__zoom-level"
          title={labels.zoomReset}
          onClick={onZoomReset}
        >
          {Math.round((zoom || 1) * 100)}%
        </button>
        <ToolbarButton
          title={labels.zoomIn}
          disabled={zoom >= ZOOM_MAX}
          onClick={onZoomIn}
        >
          <span className="rich-text-editor__icon-zoom-in" aria-hidden="true" />
        </ToolbarButton>
      </div>
      {/* Last control in the bar: it acts on the editor as a whole, not on the document, so
          it sits past everything that changes the document's own presentation. */}
      <ToolbarButton
        title={isFullscreen ? labels.exitFullscreen : labels.enterFullscreen}
        active={isFullscreen}
        onClick={onToggleFullscreen}
      >
        <span className="rich-text-editor__icon-fullscreen" aria-hidden="true" />
      </ToolbarButton>
    </div>
  )
}

DocumentActionsBar.propTypes = {
  editor: PropTypes.object,
  labels: PropTypes.object.isRequired,
  onError: PropTypes.func,
  isFullscreen: PropTypes.bool,
  onToggleFullscreen: PropTypes.func,
  pageGuides: PropTypes.bool,
  onTogglePageGuides: PropTypes.func,
  pageSetup: PropTypes.object,
  onPageSetup: PropTypes.func,
  skipTracking: PropTypes.bool,
  reviewMode: PropTypes.bool,
  currentUserName: PropTypes.string,
  zoom: PropTypes.number,
  onZoomIn: PropTypes.func,
  onZoomOut: PropTypes.func,
  onZoomReset: PropTypes.func,
  onContentReplaced: PropTypes.func,
  toolbarExtras: PropTypes.node,
  titleSlot: PropTypes.node,
  onExportPdf: PropTypes.func,
}

const TipTapEditor = ({
  content,
  onChange,
  placeholder,
  editable,
  minHeight,
  onEditorReady,
  labels: labelsProp,
  onError,
  trackChanges,
  showComments,
  showChangeComments,
  commentMode: commentModeProp,
  onRequestComment,
  onImageRequest,
  onChangeWithAI,
  commentOnly,
  toolbarExtras,
  insertExtras,
  titleSlot,
  onExportPdf,
  placeholderSuggestion,
  knownTokens,
  selectionExtras,
  sidePanel,
}) => {
  const labels = { ...DEFAULT_LABELS, ...labelsProp }
  const lastEmittedHtmlRef = useRef(content ?? '')
  const rootRef = useRef(null)
  const scrollRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  // Toolbar "Add comment" target, consumed by the in-editor comment margin to open a composer.
  const [pendingCommentTarget, setPendingCommentTarget] = useState(null)
  // Whether the margin currently has any cards — drives the reserved gutter space.
  const [hasComments, setHasComments] = useState(false)
  const [pageGuides, setPageGuides] = useState(true)
  // On-screen scale of the paper only (toolbar/margin stay fixed size) — a plain CSS `zoom`
  // on the paper element, not a layout-preserving `transform`, so the scroll container's
  // scrollable height grows/shrinks with it automatically.
  const [zoom, setZoom] = useState(1)
  // Mirror for scheduleAutoFitZoom's rAF closure, which else would read a stale zoom.
  const zoomRef = useRef(zoom)
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])
  // Initial page setup comes out of the content itself (the persisted marker comment), so a
  // saved contract reopens with the exact page geometry it was authored with.
  const [pageSetup, setPageSetup] = useState(() => parsePageSetupMarker(content).pageSetup)
  // Mirror for the useEditor onUpdate closure, which is created once and would otherwise
  // read a stale pageSetup forever.
  const pageSetupRef = useRef(pageSetup)
  const [pageHeightPx, setPageHeightPx] = useState(null)
  const [counts, setCounts] = useState(() => {
    const text = getRichTextPlainText(parsePageSetupMarker(content).html)
    return { words: countWords(text), characters: text.length }
  })

  // Compute the on-screen height of one printable page so the page-break guides land where
  // Word would actually break. The paper's rendered content width maps to the source's
  // printable width (twips); apply that same px-per-twip scale to the printable height.
  useEffect(() => {
    if (!pageGuides) return undefined
    const A4 = { w: 11906, h: 16838, mL: 1134, mR: 1134, mT: 1134, mB: 1134 }
    const pw = pageSetup?.size?.width || A4.w
    const ph = pageSetup?.size?.height || A4.h
    const mL = pageSetup?.margins?.left ?? A4.mL
    const mR = pageSetup?.margins?.right ?? A4.mR
    const mT = pageSetup?.margins?.top ?? A4.mT
    const mB = pageSetup?.margins?.bottom ?? A4.mB
    const printableWidthTwips = Math.max(1, pw - mL - mR)
    const printableHeightTwips = Math.max(1, ph - mT - mB)

    const measure = () => {
      const proseEl = rootRef.current?.querySelector('.ProseMirror')
      if (!proseEl) return
      // Content-box width (excludes the paper's own padding) ≈ the printable width on paper.
      const cs = window.getComputedStyle(proseEl)
      // clientWidth is reported in the element's own LOCAL (nominal, pre-zoom) pixel space —
      // CSS `zoom` scales how it's *rendered*, not what clientWidth/scrollWidth report — so
      // this is already the right value for --legal-page-height, a NOMINAL size consumed by a
      // calc() on that same zoomed element (which re-applies the zoom once, at render time).
      const innerWidth =
        proseEl.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0')
      if (innerWidth <= 0) return
      const scale = innerWidth / printableWidthTwips
      setPageHeightPx(Math.round(printableHeightTwips * scale))
    }
    // Defer once so the ProseMirror node is laid out before the first measure.
    const raf = requestAnimationFrame(measure)
    const ro = new ResizeObserver(measure)
    if (rootRef.current) ro.observe(rootRef.current)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [pageGuides, pageSetup])

  // Auto-fit the zoom so a freshly loaded/imported document never OPENS with a table already
  // bleeding into the review comment margin (a raw .docx import's column widths are captured
  // from the source page and can be wider than this page — see the CSS comment on `table` in
  // contract-editor.scss). Deliberately a one-shot check on load/import, NOT a live ResizeObserver
  // like the page-height effect above — re-fitting continuously would fight a reviewer's own
  // zoom choice mid-session (e.g. right after they zoom in to read something, or resize a
  // column). Only zooms OUT to make room; never zooms in past what the author/reviewer set.
  const scheduleAutoFitZoom = () => {
    requestAnimationFrame(() => {
      const rootEl = rootRef.current
      const proseEl = rootEl?.querySelector('.ProseMirror')
      const trackEl = rootEl?.querySelector('.rich-text-editor__content')
      if (!proseEl || !trackEl) return
      // clientWidth/scrollWidth are reported in the (zoomed) element's own LOCAL, pre-zoom
      // pixel space — NOT the real on-screen size — so these three are directly comparable
      // without adjusting for the current zoom (see the pageHeightPx effect above for the
      // same nuance).
      const pageWidth = proseEl.clientWidth // the paper's own max-width box, no overflow
      const contentWidth = proseEl.scrollWidth // paper's content extent, incl. table overflow
      const trackWidth = trackEl.clientWidth // doc column's real (unzoomed) box width
      if (!(trackWidth > 0) || !(contentWidth > pageWidth)) return
      // The paper is horizontally centered in the doc column (`margin: 0 auto`), so at zoom z
      // the gap ahead of it is (trackWidth - pageWidth·z) / 2 — solve for the largest z that
      // keeps gap(z) + contentWidth·z ≤ trackWidth, i.e. the overflow stays inside the column,
      // clear of the comment margin next to it.
      const denominator = contentWidth - pageWidth / 2
      if (!(denominator > 0)) return
      const fitZoom = clampZoom(trackWidth / 2 / denominator)
      if (fitZoom < zoomRef.current - AUTO_FIT_MIN_DELTA) setZoom(fitZoom)
    })
  }

  // Leave fullscreen on Escape.
  useEffect(() => {
    if (!isFullscreen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setIsFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFullscreen])

  const editor = useEditor({
    extensions: buildExtensions(placeholder, trackChanges, placeholderSuggestion, knownTokens),
    // The editor itself only ever sees the HTML — the page-setup marker is stripped here
    // and re-attached on every emit.
    content: parsePageSetupMarker(content).html,
    editable: editable !== false,
    editorProps: {
      attributes: {
        class: 'rich-text-editor__prose legal-template-editor__prose',
        style: `min-height: ${minHeight || 200}px`,
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = withPageSetupMarker(serializeLegalDocumentEditorHtml(ed), pageSetupRef.current)
      lastEmittedHtmlRef.current = html
      onChange?.(html)
      const text = ed.getText()
      setCounts({ words: countWords(text), characters: text.length })
    },
  })

  // Route ALL page-setup changes (layout tool, .docx import, reset) through here so the new
  // geometry is immediately re-embedded in the emitted content — otherwise changing margins
  // without touching the text would never reach the parent form, and would be lost on save.
  const handlePageSetup = (next) => {
    pageSetupRef.current = next
    setPageSetup(next)
    if (!editorCanCommand(editor)) return

    // Tables hold absolute pixel column widths, so a page that just got wider or narrower
    // leaves them at their old size — a white strip down one side that no margin setting can
    // close. Re-fit them to the new printable width, then emit ONCE with both changes in it.
    // `next` is passed so the refit computes the width from the chosen geometry itself —
    // measuring the DOM here loses a race with React applying the new CSS variables.
    refitTablesToPrintableWidth(editor, next)
    const html = withPageSetupMarker(serializeLegalDocumentEditorHtml(editor), next)
    lastEmittedHtmlRef.current = html
    onChange?.(html)
  }

  // The vocabulary grows while the author works — every question written adds a
  // `{{wizard.<factKey>}}`, every rename changes one — but extensions are
  // configured once, at creation. Without this the list would be frozen at
  // mount and a token the author just made valid would keep rendering as a
  // mistake. Compared by value: hosts build this array inline.
  const knownTokensKey = Array.isArray(knownTokens) ? knownTokens.join('\u0000') : ''
  useEffect(() => {
    // TipTap nulls `commandManager` on destroy while the Editor object stays
    // truthy. Under StrictMode an effect still holds that instance and
    // `editor.commands` throws "Cannot read properties of null (reading
    // 'commands')" — the tax certificate Edit path is how that usually shows.
    if (!editorCanCommand(editor)) return
    try {
      editor.commands.setKnownTokens(Array.isArray(knownTokens) ? knownTokens : null)
    } catch {
      // StrictMode can destroy between the guard and the call; ignore.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by value, not identity
  }, [editor, knownTokensKey])

  useEffect(() => {
    // Same StrictMode teardown guard as the `setKnownTokens` effect above.
    if (!editorCanCommand(editor) || content === undefined) return
    // Skip echo from our own onUpdate — resetting here collapses blank lines.
    if (content === lastEmittedHtmlRef.current) return
    // While typing, the parent may lag one frame behind the editor.
    if (editor.isFocused) return
    // External content push (initial load after fetch, form reset): split it back into the
    // page-setup marker + document HTML, and sync both. The pageSetup update below mirrors
    // the imperative editor.commands.setContent() call right above it — both are syncing the
    // same external `content` prop change, one into the ProseMirror editor, one into React
    // state; they're inseparable (guarded by the same echo/focus checks) so this is kept as
    // one effect rather than split into a fragile "adjust state during render" duplicate of
    // this same parsing + guard logic.
    const parsed = parsePageSetupMarker(content || '')
    applyEditorContent(editor, parsed.html, { skipTracking: Boolean(trackChanges?.enabled) })
    if (!editorCanCommand(editor)) return
    // Repair-only pass: a saved document can carry a table wider than its own printable
    // width (the page marker and the table widths are saved together but can be captured
    // out of sync), and CSS cannot cap it — a fixed-layout table's colgroup beats
    // max-width, so it visibly spills off the paper's edge. Clamp such tables back to the
    // printable width; tables that fit are never touched.
    refitTablesToPrintableWidth(editor, parsed.pageSetup, { onlyOverflowing: true })
    lastEmittedHtmlRef.current = content
    pageSetupRef.current = parsed.pageSetup
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
    setPageSetup(parsed.pageSetup)
    scheduleAutoFitZoom()
  }, [content, editor, trackChanges?.enabled])

  // Same one-shot fit check the moment the editor first mounts with its initial content —
  // the effect above only fires on later external `content` prop changes.
  useEffect(() => {
    // Same StrictMode teardown guard as the effects above — `refitTables…`
    // reads `editor.state`, which is gone on a destroyed instance.
    if (!editorCanCommand(editor)) return
    // Same repair-only clamp as the external-content effect, for the INITIAL content the
    // editor was created with (that effect only fires on later prop changes).
    refitTablesToPrintableWidth(editor, pageSetupRef.current, { onlyOverflowing: true })
    scheduleAutoFitZoom()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on editor creation only
  }, [editor])

  useEffect(() => {
    if (!editorCanCommand(editor)) return
    editor.setEditable(editable !== false)
  }, [editor, editable])

  useEffect(() => {
    onEditorReady?.(editor || null)
    return () => onEditorReady?.(null)
  }, [editor, onEditorReady])

  if (!editor) {
    return (
      <div
        className="rich-text-editor legal-template-editor"
        style={{
          minHeight: minHeight || 200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Spinner />
      </div>
    )
  }

  // In-editor comment margin: only in review mode (redline engine on) and when the host wants
  // the panel shown. Mode picks which actions each card offers.
  const commentPanelActive = Boolean(trackChanges?.enabled) && showChangeComments !== false
  // readOnly / commentOnly are forced by editability; otherwise the host picks 'reviewer'
  // (lawyer: accept/reject) or 'author' (tenant: revert own edits). Defaults to reviewer.
  const commentMode =
    editable === false ? 'readOnly' : commentOnly ? 'commentOnly' : commentModeProp || 'reviewer'

  return (
    <div
      ref={rootRef}
      className={classNames('rich-text-editor legal-template-editor', {
        'legal-template-editor--fullscreen': isFullscreen,
        'legal-template-editor--page-guides': pageGuides && pageHeightPx > 0,
        'legal-template-editor--has-comments': commentPanelActive && hasComments,
      })}
      style={{
        minHeight: minHeight || 200,
        '--legal-page-height': `${pageHeightPx || 1160}px`,
        '--legal-zoom': zoom,
        ...buildLayoutVars(pageSetup),
      }}
    >
      {editable !== false ? (
        <DocumentActionsBar
          editor={editor}
          labels={labels}
          onError={onError}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => setIsFullscreen((v) => !v)}
          pageGuides={pageGuides}
          onTogglePageGuides={() => setPageGuides((v) => !v)}
          pageSetup={pageSetup}
          onPageSetup={handlePageSetup}
          skipTracking={Boolean(trackChanges?.enabled)}
          reviewMode={Boolean(trackChanges?.enabled)}
          currentUserName={trackChanges?.currentUserName}
          zoom={zoom}
          onZoomIn={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
          onZoomOut={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
          onZoomReset={() => setZoom(1)}
          onContentReplaced={scheduleAutoFitZoom}
          toolbarExtras={toolbarExtras}
          titleSlot={titleSlot}
          onExportPdf={onExportPdf}
        />
      ) : toolbarExtras || titleSlot ? (
        // Read-only still shows the host's own controls — a reader needs version history and
        // a preview/edit switch just as much as an author, and the rest of the actions bar
        // (import, export, zoom) is what's inappropriate here, not the slot.
        <div className="legal-template-editor__doc-actions">
          {titleSlot ? (
            <div className="legal-template-editor__title-slot">{titleSlot}</div>
          ) : null}
          <div className="legal-template-editor__doc-actions-spacer" />
          {toolbarExtras ? (
            <div className="legal-template-editor__toolbar-extras">{toolbarExtras}</div>
          ) : null}
        </div>
      ) : null}
      <Tiptap editor={editor}>
        {editable !== false && (
          <TipTapMenuBar
            labels={labels}
            commentOnly={commentOnly}
            onImageRequest={onImageRequest}
            onChangeWithAI={onChangeWithAI}
            insertExtras={insertExtras}
            onComment={
              showComments && trackChanges?.enabled
                ? () =>
                    requestCommentOnSelection(
                      editor,
                      trackChanges?.currentUserName || 'Unknown',
                      (target) => {
                        // Open the in-editor margin composer on the targeted change, and still
                        // notify the host in case it tracks the request itself.
                        setPendingCommentTarget(target)
                        onRequestComment?.(target)
                      },
                    )
                : undefined
            }
          />
        )}
        <div className="legal-template-editor__body">
        <div className="legal-template-editor__scroll" ref={scrollRef}>
          <Tiptap.Content className="rich-text-editor__content" />
          {commentPanelActive && (
            <CommentMargin
              editor={editor}
              scrollRef={scrollRef}
              mode={commentMode}
              currentUserName={trackChanges?.currentUserName || 'Unknown'}
              labels={labels}
              pendingCommentTarget={pendingCommentTarget}
              onCommentTargetHandled={() => setPendingCommentTarget(null)}
              onHasCommentsChange={setHasComments}
            />
          )}
        </div>
        {sidePanel ? <div className="legal-template-editor__side-panel">{sidePanel}</div> : null}
        </div>
        {editable !== false && <TipTapBubbleMenu selectionExtras={selectionExtras} />}
      </Tiptap>
      <div className="legal-template-editor__wordcount">
        {counts.words} {labels.words} · {counts.characters} {labels.characters}
      </div>
    </div>
  )
}

TipTapEditor.propTypes = {
  content: PropTypes.string,
  onChange: PropTypes.func,
  placeholder: PropTypes.string,
  editable: PropTypes.bool,
  minHeight: PropTypes.number,
  onEditorReady: PropTypes.func,
  labels: PropTypes.object,
  onError: PropTypes.func,
  // Review mode: enable the track-changes (redline) engine.
  trackChanges: PropTypes.shape({
    enabled: PropTypes.bool,
    currentUserName: PropTypes.string,
  }),
  // Show the "Add comment" toolbar button (review mode only).
  showComments: PropTypes.bool,
  // Show the in-editor anchored comment margin (review mode only). Defaults on; set false to
  // hide the whole margin (e.g. a host "Show change comments" toggle).
  showChangeComments: PropTypes.bool,
  // Card actions in the margin: 'reviewer' (accept/reject) or 'author' (revert own edits).
  // readOnly / commentOnly are derived from editable/commentOnly and override this.
  commentMode: PropTypes.oneOf(['reviewer', 'author', 'lawyer']),
  // Called with the { from, to } selection range when the user requests a comment, so the
  // host app can open its own comment sidebar/composer for that range.
  onRequestComment: PropTypes.func,
  // Override the image toolbar button — called with the editor so the host app can open its
  // own media picker and insert via editor.chain().setImage(...). Defaults to a URL prompt.
  onImageRequest: PropTypes.func,
  // When provided, shows a "Change with AI" toolbar button that calls this.
  onChangeWithAI: PropTypes.func,
  // Review "comment only" stage: hide formatting tools, keep only commenting.
  commentOnly: PropTypes.bool,
  // Host-supplied controls rendered inside the editor's document-actions bar. Lets an app
  // put its own document-level actions (version history, a preview toggle, a comments
  // switch) in the editor chrome instead of floating above it, without this module
  // learning anything about those features.
  toolbarExtras: PropTypes.node,
  // Host-supplied insert tools rendered in the formatting toolbar, alongside image/link/
  // table. Same contract as toolbarExtras: this module only renders the node.
  insertExtras: PropTypes.node,
  // Optional inline document title shown in the actions bar, after the File menu.
  titleSlot: PropTypes.node,
  // Replaces the built-in browser-print PDF export. Pass this when the host renders PDFs
  // itself (e.g. server-side) so export matches the document it actually distributes.
  onExportPdf: PropTypes.func,
  /** Enables `{{` type-ahead. Pass STABLE function identities — the plugin is
   *  configured once when the editor is created and does not re-read new closures. */
  knownTokens: PropTypes.arrayOf(PropTypes.string),
  placeholderSuggestion: PropTypes.shape({
    onStateChange: PropTypes.func,
    onKeyDown: PropTypes.func,
  }),
  /** Host tools rendered into the selection bubble menu. Pass JSX. */
  selectionExtras: PropTypes.node,
  /** Panel rendered inside the editor chrome, beside the paper. */
  sidePanel: PropTypes.node,
}

export default TipTapEditor
