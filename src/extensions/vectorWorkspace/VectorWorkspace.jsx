/**
 * The vector workspace — SVG-Edit's headless canvas (`@svgedit/svgcanvas`) with an
 * Illustrator-style toolbar, rendered in place of one illustration while it is edited.
 *
 * The engine is used as it is, with the three things it does not do for us done here:
 *
 *  - It has no dispose. Its container listeners die with the container, but the
 *    constructor also registers a `storage` listener on `window` that nothing removes;
 *    `captureWindowListeners` records what it adds during construction so the cleanup
 *    can remove it. One workspace exists at a time (vectorIllustration.js), so at most
 *    one canvas is ever alive.
 *  - It looks up a few elements by id (`svgcanvas` for a mouse-up dispatched when the
 *    pointer leaves mid-drag, `zoom` and `workarea` for shift+wheel zoom). They live here,
 *    and are unique because the workspace is.
 *  - It handles no keys. Delete, undo/redo and Escape are wired below; the node view's
 *    `stopEvent` keeps them from ProseMirror.
 *
 * Events: `bind(name, fn)` holds ONE handler per name and has no unbind; the callback
 * receives `(window, payload)`. Everything is bound once here and rebound to no-ops on
 * teardown.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import classNames from 'classnames'
import { DEFAULT_ARTBOARD, cropSvgTo, drawnBox, sanitizeSvg, svgForCanvas, viewBoxOf } from '../vectorSvg.js'

const CANVAS_MARGIN = 24 // room around the artboard for selection grips
const DEFAULT_LABELS = {
  vectorSelect: 'Select (V)',
  vectorEditPoints: 'Edit points — anchors and bezier handles (A)',
  vectorPen: 'Pen — click to add anchors, drag for curves (P)',
  vectorRect: 'Rectangle (R)',
  vectorCircle: 'Circle (C)',
  vectorEllipse: 'Ellipse (E)',
  vectorFill: 'Fill',
  vectorStroke: 'Stroke',
  vectorStrokeWidth: 'Stroke width',
  vectorNone: 'None',
  vectorFront: 'Bring to front',
  vectorBack: 'Send to back',
  vectorUndo: 'Undo',
  vectorRedo: 'Redo',
  vectorDelete: 'Delete selection',
  vectorApply: 'Save / Apply changes',
  vectorCancel: 'Cancel',
  vectorDiscard: 'Discard the changes to this illustration?',
  vectorLoadError: 'The vector editor could not be loaded.',
}

const TOOL_MODES = {
  select: 'select',
  pen: 'path',
  rect: 'rect',
  circle: 'circle',
  ellipse: 'ellipse',
}

/** Run `fn`, returning a remover for every window listener it registered. */
const captureWindowListeners = (fn) => {
  const added = []
  const original = window.addEventListener
  window.addEventListener = function patched(type, listener, options) {
    added.push([type, listener, options])
    return original.call(this, type, listener, options)
  }
  try {
    return { result: fn(), remove: () => added.forEach((args) => window.removeEventListener(...args)) }
  } finally {
    window.addEventListener = original
  }
}

const toHex = (value) => {
  const text = String(value || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(text)) return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase()
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(text)
  if (rgb) return `#${rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
  return null
}

const ToolButton = ({ active, disabled, title, onClick, children }) => (
  <button
    type="button"
    className={classNames('rich-text-editor__toolbar-btn', { 'rich-text-editor__toolbar-btn--active': active })}
    title={title}
    aria-label={title}
    aria-pressed={active}
    disabled={disabled}
    onMouseDown={(event) => event.preventDefault()} // keep the canvas's focus/selection
    onClick={onClick}
  >
    {children}
  </button>
)
ToolButton.propTypes = {
  active: PropTypes.bool,
  disabled: PropTypes.bool,
  title: PropTypes.string,
  onClick: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
}

const VectorWorkspace = ({ editor, node, pos, labels: labelOverrides }) => {
  const labels = { ...DEFAULT_LABELS, ...(labelOverrides || {}) }
  const rootRef = useRef(null)
  const canvasHostRef = useRef(null)
  const textInputRef = useRef(null)
  const canvasRef = useRef(null)
  const dirtyRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)
  const [tool, setTool] = useState('select')
  const [selection, setSelection] = useState([])
  const [fill, setFill] = useState('#ffffff')
  const [stroke, setStroke] = useState('#000000')
  const [strokeWidth, setStrokeWidth] = useState(2)
  const [fillNone, setFillNone] = useState(false)
  const [strokeNone, setStrokeNone] = useState(false)

  const close = useCallback(() => editor.commands.closeVectorWorkspace(), [editor])

  useEffect(() => {
    let cancelled = false
    let teardown = null
    ;(async () => {
      let SvgCanvas
      try {
        const mod = await import('@svgedit/svgcanvas')
        SvgCanvas = mod.default ?? mod
      } catch (err) {
        if (!cancelled) setError(err)
        return
      }
      if (cancelled || !canvasHostRef.current) return
      // The artboard: at least the default size, and large enough to hold a stored
      // drawing, which keeps the absolute coordinates it was drawn with (see svgForCanvas).
      const box = viewBoxOf(node.attrs.svg)
      const width = Math.ceil(Math.max(DEFAULT_ARTBOARD.width, box ? box.x + box.width + CANVAS_MARGIN : 0))
      const height = Math.ceil(Math.max(DEFAULT_ARTBOARD.height, box ? box.y + box.height + CANVAS_MARGIN : 0))
      const host = canvasHostRef.current
      host.replaceChildren()
      const { result: canvas, remove: removeWindowListeners } = captureWindowListeners(
        () =>
          new SvgCanvas(host, {
            initFill: { color: 'ffffff', opacity: 1 },
            initStroke: { color: '000000', opacity: 1, width: 2 },
            initOpacity: 1,
            dimensions: [width, height],
            baseUnit: 'px',
            imgPath: '',
            text: { stroke_width: 0, font_size: 16, font_family: 'Arial, sans-serif' },
            selectNew: true,
            show_outside_canvas: false,
          }),
      )
      try {
        canvas.textActions?.setInputElem?.(textInputRef.current)
        // setSvgString rebuilds `svgcontent`, so the canvas geometry (content offset inside
        // the root, background sheet) must be laid out AFTER the document is in.
        const loaded = canvas.setSvgString(svgForCanvas(node.attrs.svg, width, height), true)
        if (loaded === false) throw new Error('The stored SVG could not be opened.')
        canvas.setResolution?.(width, height)
        canvas.updateCanvas(width + CANVAS_MARGIN * 2, height + CANVAS_MARGIN * 2)
        canvas.undoMgr?.resetUndoStack?.()
        canvas.setMode('select')
        canvas.bind('changed', () => {
          dirtyRef.current = true
        })
        canvas.bind('selected', (_win, elems) => {
          const list = (Array.isArray(elems) ? elems : []).filter(Boolean)
          setSelection(list)
          const first = list[0]
          if (!first) return
          const f = first.getAttribute('fill')
          const s = first.getAttribute('stroke')
          const w = parseFloat(first.getAttribute('stroke-width'))
          setFillNone(f === 'none')
          setStrokeNone(s === 'none')
          if (toHex(f)) setFill(toHex(f))
          if (toHex(s)) setStroke(toHex(s))
          if (Number.isFinite(w)) setStrokeWidth(w)
        })
        canvas.bind('contextset', () => {})
      } catch (err) {
        removeWindowListeners()
        host.replaceChildren()
        if (!cancelled) setError(err)
        return
      }
      canvasRef.current = canvas
      // The live instance for anything outside this component (the editor toolbar, tests).
      if (editor.storage.vectorIllustration) editor.storage.vectorIllustration.canvas = canvas
      teardown = () => {
        ;['changed', 'selected', 'contextset', 'zoomed', 'pointsAdded'].forEach((name) => canvas.bind(name, () => {}))
        removeWindowListeners()
        host.replaceChildren()
        canvasRef.current = null
        if (editor.storage.vectorIllustration?.canvas === canvas) editor.storage.vectorIllustration.canvas = null
      }
      setReady(true)
      rootRef.current?.focus({ preventScroll: true })
    })()
    return () => {
      cancelled = true
      teardown?.()
    }
    // The workspace edits exactly the illustration it was opened for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canvas = () => canvasRef.current

  const chooseTool = (name) => {
    const c = canvas()
    if (!c) return
    c.setMode(TOOL_MODES[name])
    setTool(name)
  }

  const editPoints = () => {
    const c = canvas()
    const elem = selection[0]
    if (!c || !elem) return
    // Anchor points exist on paths; a rect/ellipse is converted first, as in Illustrator.
    let path = elem
    if (elem.tagName !== 'path' && typeof c.convertToPath === 'function') {
      path = c.convertToPath(elem) || c.getSelectedElements?.()?.[0] || elem
    }
    c.pathActions.toEditMode(path)
    setTool('points')
  }

  const applyColor = (type, hex, none) => {
    const c = canvas()
    if (!c) return
    // setColor writes the value straight into the attribute, so it takes the '#' (only the
    // constructor's initFill/initStroke go without).
    c.setColor(type, none ? 'none' : hex)
    dirtyRef.current = true
  }

  const apply = () => {
    const c = canvas()
    if (!c) return
    if (c.getCurrentMode?.() === 'pathedit') c.setMode('select')
    c.clearSelection?.()
    // The block covers exactly the drawing: crop to what is on the canvas (stroke included);
    // an empty canvas keeps the artboard so the block stays visible and editable.
    const content = canvasHostRef.current?.querySelector('#svgcontent')
    const box = content ? drawnBox(content) : null
    const sanitized = sanitizeSvg(c.getSvgString())
    const clean = sanitized && box ? cropSvgTo(sanitized.svg, box) : sanitized
    if (!clean) {
      setError(new Error('Nothing drawable was left after sanitising the illustration.'))
      return
    }
    editor
      .chain()
      .updateVectorIllustration(pos, { svg: clean.svg, width: clean.width, height: clean.height })
      .closeVectorWorkspace()
      .run()
    editor.commands.focus()
  }

  const cancel = () => {
    if (dirtyRef.current && !window.confirm(labels.vectorDiscard)) return
    close()
    editor.commands.focus()
  }

  const onKeyDown = (event) => {
    const c = canvas()
    const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName || '')
    const mod = event.metaKey || event.ctrlKey
    if (event.key === 'Escape') {
      event.preventDefault()
      if (c?.getCurrentMode?.() === 'pathedit') {
        c.setMode('select')
        setTool('select')
      } else cancel()
      return
    }
    if (inField || !c) return
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      c.deleteSelectedElements()
    } else if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) c.undoMgr?.redo()
      else c.undoMgr?.undo()
    } else if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      c.undoMgr?.redo()
    } else if (!mod && /^[vaprce]$/i.test(event.key)) {
      const key = event.key.toLowerCase()
      if (key === 'a') editPoints()
      else chooseTool({ v: 'select', p: 'pen', r: 'rect', c: 'circle', e: 'ellipse' }[key])
    }
  }

  const hasSelection = selection.length > 0

  return (
    <div
      ref={rootRef}
      className={classNames('legal-vector-workspace', { 'legal-vector-workspace--ready': ready })}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      role="application"
      aria-label="Vector editor"
    >
      <div className="rich-text-editor__toolbar legal-vector-workspace__toolbar" role="toolbar">
        <div className="rich-text-editor__toolbar-group">
          <ToolButton title={labels.vectorSelect} active={tool === 'select'} onClick={() => chooseTool('select')}>
            <span className="legal-vector-icon legal-vector-icon--select" aria-hidden="true" />
          </ToolButton>
          <ToolButton title={labels.vectorEditPoints} active={tool === 'points'} disabled={!hasSelection} onClick={editPoints}>
            <span className="legal-vector-icon legal-vector-icon--points" aria-hidden="true" />
          </ToolButton>
          <ToolButton title={labels.vectorPen} active={tool === 'pen'} onClick={() => chooseTool('pen')}>
            <span className="legal-vector-icon legal-vector-icon--pen" aria-hidden="true" />
          </ToolButton>
        </div>
        <div className="rich-text-editor__toolbar-group">
          <ToolButton title={labels.vectorRect} active={tool === 'rect'} onClick={() => chooseTool('rect')}>
            <span className="legal-vector-icon legal-vector-icon--rect" aria-hidden="true" />
          </ToolButton>
          <ToolButton title={labels.vectorCircle} active={tool === 'circle'} onClick={() => chooseTool('circle')}>
            <span className="legal-vector-icon legal-vector-icon--circle" aria-hidden="true" />
          </ToolButton>
          <ToolButton title={labels.vectorEllipse} active={tool === 'ellipse'} onClick={() => chooseTool('ellipse')}>
            <span className="legal-vector-icon legal-vector-icon--ellipse" aria-hidden="true" />
          </ToolButton>
        </div>
        <div className="rich-text-editor__toolbar-group legal-vector-workspace__props">
          <label className="legal-vector-workspace__prop" title={labels.vectorFill}>
            <span>{labels.vectorFill}</span>
            <input
              type="color"
              value={fill}
              disabled={fillNone}
              onChange={(event) => {
                setFill(event.target.value)
                applyColor('fill', event.target.value, false)
              }}
            />
            <input
              type="checkbox"
              title={`${labels.vectorFill}: ${labels.vectorNone}`}
              checked={fillNone}
              onChange={(event) => {
                setFillNone(event.target.checked)
                applyColor('fill', fill, event.target.checked)
              }}
            />
          </label>
          <label className="legal-vector-workspace__prop" title={labels.vectorStroke}>
            <span>{labels.vectorStroke}</span>
            <input
              type="color"
              value={stroke}
              disabled={strokeNone}
              onChange={(event) => {
                setStroke(event.target.value)
                applyColor('stroke', event.target.value, false)
              }}
            />
            <input
              type="checkbox"
              title={`${labels.vectorStroke}: ${labels.vectorNone}`}
              checked={strokeNone}
              onChange={(event) => {
                setStrokeNone(event.target.checked)
                applyColor('stroke', stroke, event.target.checked)
              }}
            />
          </label>
          <label className="legal-vector-workspace__prop" title={labels.vectorStrokeWidth}>
            <span>{labels.vectorStrokeWidth}</span>
            <input
              type="number"
              min="0"
              max="64"
              step="0.5"
              value={strokeWidth}
              onChange={(event) => {
                const value = Math.max(0, parseFloat(event.target.value) || 0)
                setStrokeWidth(value)
                canvas()?.setStrokeWidth(value)
                dirtyRef.current = true
              }}
            />
          </label>
        </div>
        <div className="rich-text-editor__toolbar-group">
          <ToolButton title={labels.vectorFront} disabled={!hasSelection} onClick={() => canvas()?.moveToTopSelectedElement()}>
            <span className="legal-vector-icon legal-vector-icon--front" aria-hidden="true" />
          </ToolButton>
          <ToolButton title={labels.vectorBack} disabled={!hasSelection} onClick={() => canvas()?.moveToBottomSelectedElement()}>
            <span className="legal-vector-icon legal-vector-icon--back" aria-hidden="true" />
          </ToolButton>
        </div>
        <div className="rich-text-editor__toolbar-group">
          <ToolButton title={labels.vectorUndo} onClick={() => canvas()?.undoMgr?.undo()}>
            <span className="rich-text-editor__icon-undo" aria-hidden="true" />
          </ToolButton>
          <ToolButton title={labels.vectorRedo} onClick={() => canvas()?.undoMgr?.redo()}>
            <span className="rich-text-editor__icon-redo" aria-hidden="true" />
          </ToolButton>
          <ToolButton title={labels.vectorDelete} disabled={!hasSelection} onClick={() => canvas()?.deleteSelectedElements()}>
            ✕
          </ToolButton>
        </div>
        <div className="rich-text-editor__toolbar-group legal-vector-workspace__actions">
          <button type="button" className="legal-vector-workspace__apply" onClick={apply} disabled={!ready}>
            {labels.vectorApply}
          </button>
          <button type="button" className="legal-vector-workspace__cancel" onClick={cancel}>
            {labels.vectorCancel}
          </button>
        </div>
      </div>

      {error ? (
        <div className="legal-vector-workspace__error" role="alert">
          {labels.vectorLoadError} {String(error.message || error)}
        </div>
      ) : null}
      {!ready && !error ? <span className="contract-editor__spinner legal-vector-workspace__spinner" aria-hidden="true" /> : null}

      {/* The ids are what svgcanvas looks up; see the module comment. */}
      <div id="workarea" className="legal-vector-workspace__workarea">
        <div id="svgcanvas" ref={canvasHostRef} className="legal-vector-workspace__canvas" />
      </div>
      <input id="zoom" type="hidden" defaultValue="100" />
      <input ref={textInputRef} type="text" className="legal-vector-workspace__text-input" tabIndex={-1} aria-hidden="true" />
    </div>
  )
}

VectorWorkspace.propTypes = {
  editor: PropTypes.object.isRequired,
  node: PropTypes.object.isRequired,
  pos: PropTypes.number.isRequired,
  labels: PropTypes.object,
}

export default VectorWorkspace
