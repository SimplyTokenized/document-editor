/**
 * Node view of a vector illustration: the drawing inline (Preview), or — for the one
 * illustration the editor has open — the SVG-Edit workspace in its place. The workspace
 * component is loaded on first use; the engine it wraps is ~1.4 MB and belongs in no
 * one's initial bundle.
 */
import React, { Suspense, lazy, useEffect, useRef } from 'react'
import PropTypes from 'prop-types'
import classNames from 'classnames'
import { NodeViewWrapper, useEditorState } from '@tiptap/react'
import { vectorPresentationStyle, normalizeWrap } from '../vectorLayout.js'
import { svgToElement } from '../vectorSvg.js'
import { getVectorWorkspacePos } from './workspaceState.js'

const VectorWorkspace = lazy(() => import('./VectorWorkspace.jsx'))

/** `display:block;max-width:100%;…` (what the stored HTML carries) → a React style object. */
const styleObject = (cssText) =>
  Object.fromEntries(
    cssText
      .split(';')
      .map((rule) => rule.trim())
      .filter(Boolean)
      .map((rule) => {
        const [prop, ...rest] = rule.split(':')
        return [prop.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase()), rest.join(':').trim()]
      }),
  )

const Loading = () => (
  <div className="legal-vector-workspace legal-vector-workspace--loading">
    <span className="contract-editor__spinner" aria-hidden="true" />
  </div>
)

const VectorIllustrationView = ({ node, editor, getPos, selected }) => {
  const editingPos = useEditorState({
    editor,
    selector: ({ editor: ed }) => (ed && !ed.isDestroyed ? getVectorWorkspacePos(ed.state) : null),
  })
  const pos = typeof getPos === 'function' ? getPos() : null
  const editing = editingPos != null && editingPos === pos
  const previewRef = useRef(null)
  const labels = editor.storage?.vectorIllustration?.labels || {}

  useEffect(() => {
    if (editing) return
    const host = previewRef.current
    if (!host) return
    const el = svgToElement(node.attrs.svg, { width: node.attrs.width, height: node.attrs.height })
    host.replaceChildren(...(el ? [el] : []))
  }, [editing, node.attrs.svg, node.attrs.width, node.attrs.height])

  const style = styleObject(vectorPresentationStyle(node.attrs))

  return (
    <NodeViewWrapper
      as="figure"
      className={classNames('legal-vector', {
        'legal-vector--selected': selected && !editing,
        'legal-vector--editing': editing,
      })}
      data-align={node.attrs.align}
      data-wrap={normalizeWrap(node.attrs.wrap)}
      style={editing ? undefined : style}
      data-drag-handle={editing ? undefined : ''}
    >
      {editing ? (
        <Suspense fallback={<Loading />}>
          <VectorWorkspace editor={editor} node={node} pos={pos} labels={labels} />
        </Suspense>
      ) : (
        <>
          <div ref={previewRef} className="legal-vector__preview" />
          {editor.isEditable ? (
            <button
              type="button"
              className="legal-vector__edit"
              // mousedown would move ProseMirror's selection before the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor.commands.openVectorWorkspace(pos)}
            >
              {labels.editVector || '✒️ Edit Vector'}
            </button>
          ) : null}
        </>
      )}
    </NodeViewWrapper>
  )
}

VectorIllustrationView.propTypes = {
  node: PropTypes.object.isRequired,
  editor: PropTypes.object.isRequired,
  getPos: PropTypes.func.isRequired,
  selected: PropTypes.bool,
}

export default VectorIllustrationView
