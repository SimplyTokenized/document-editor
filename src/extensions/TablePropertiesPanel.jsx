/**
 * Contextual table sizing control for the contract editor's toolbar.
 *
 * Enabled only while the caret is inside a table; it edits *that* table's width, cell
 * padding ("distance") and row height via the LegalTable `setLegalTableLayout` command, so
 * documents with several tables can each be sized independently. Values are shown in mm
 * (padding / row height) and % (width), matching the Page & layout tool.
 *
 * The panel is fully controlled by the current table node's attributes (passed in as
 * `attrs`) — there is no local field state — so it always reflects the live document, and
 * the command is dispatched without stealing focus from the number inputs. Padding/row
 * height are read and written directly in mm (the node attribute IS mm, see legalTable.js) —
 * no px round-trip here, so a 0.1 mm step always visibly moves the field.
 */
import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import classNames from 'classnames'
import { DEFAULT_TABLE_LAYOUT } from './PageLayoutPanel.jsx'

const clampNum = (value, min, max) => {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/**
 * A number input that does not commit on every keystroke.
 *
 * These fields drive a live re-layout of the document, and committing per character meant
 * typing "10" first applied "1": a 1%-wide table becomes enormously tall, the document
 * reflows to many more pages, and the view jumps away from what you were looking at — then
 * jumps back when the second digit arrives. The draft is held locally and committed once
 * typing settles, or immediately on blur / Enter, so the document reflows once per intended
 * value instead of once per character.
 */
const useDeferredCommit = (value, onChange, min, max) => {
  const [draft, setDraft] = useState(() => String(value))
  const committed = useRef(value)
  const timer = useRef(null)

  // Follow the value when it changes from outside (a preset, a reset, another table).
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value
      setDraft(String(value))
    }
  }, [value])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const commit = (raw) => {
    window.clearTimeout(timer.current)
    const next = clampNum(raw, min, max)
    setDraft(String(next))
    if (next !== committed.current) {
      committed.current = next
      onChange(next)
    }
  }

  const onInput = (raw) => {
    setDraft(raw)
    window.clearTimeout(timer.current)
    // Long enough to finish typing a two-digit number, short enough to still feel live.
    timer.current = window.setTimeout(() => commit(raw), 450)
  }

  return { draft, onInput, commit }
}

const NumberField = ({ id, label, value, min, max, step, suffix, onChange }) => {
  const { draft, onInput, commit } = useDeferredCommit(value, onChange, min, max)
  return (
    <label className="legal-template-editor__layout-field" htmlFor={id}>
      <span className="legal-template-editor__layout-field-label">{label}</span>
      <span className="legal-template-editor__layout-field-input">
        <input
          id={id}
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onInput(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit(e.currentTarget.value)
            }
          }}
        // A focused number input silently changes value on mouse-wheel scroll in Chrome —
        // blur on wheel so scrolling the page never accidentally resizes the table.
          onWheel={(e) => e.currentTarget.blur()}
        />
        {suffix ? <span className="legal-template-editor__layout-suffix">{suffix}</span> : null}
      </span>
    </label>
  )
}

NumberField.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  value: PropTypes.number.isRequired,
  min: PropTypes.number.isRequired,
  max: PropTypes.number.isRequired,
  step: PropTypes.number,
  suffix: PropTypes.string,
  onChange: PropTypes.func.isRequired,
}

/**
 * The selected table's rendered width as a percentage of the printable width.
 *
 * Measured from the DOM because that is the only place the truth exists for a table whose
 * columns came from a .docx import: the widths are absolute pixels on the cells, with no
 * attribute recording what fraction of the page they add up to.
 *
 * @returns {number|null} null when there is nothing to measure, so the caller can fall back.
 */
const measureTableWidthPct = (editor) => {
  if (!editor || editor.isDestroyed) return null
  const { state, view } = editor
  const $from = state.selection.$from
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name !== 'table') continue
    const dom = view.nodeDOM($from.before(depth))
    const tableEl = dom?.tagName === 'TABLE' ? dom : dom?.querySelector?.('table')
    if (!tableEl) return null
    const proseEl = view.dom
    const cs = window.getComputedStyle(proseEl)
    const innerWidth =
      proseEl.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0')
    if (!(innerWidth > 0)) return null
    const pct = Math.round((tableEl.getBoundingClientRect().width / innerWidth) * 100)
    return pct > 0 ? Math.min(100, pct) : null
  }
  return null
}

const TablePropertiesPanel = ({ labels, editor, disabled, attrs }) => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  // The panel is only shown while the caret is in a table — leaving the table (disabled)
  // hides it without needing to mutate state in an effect.
  const showPanel = open && !disabled

  useEffect(() => {
    if (!showPanel) return undefined
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showPanel])

  // Current table attributes → display values, falling back to the defaults that match the
  // base table stylesheet when an attribute is unset (null).
  //
  // Width is the exception: falling back to the default 100 CLAIMED full width for any table
  // that had never been sized through this panel — an imported table sitting at 94% of the
  // page still read "100%", so the number contradicted the document and re-typing 100 was a
  // no-op because nothing had changed. Measure the real width instead and show that; the
  // attribute still wins when the author has set one.
  const widthPct = attrs?.tableWidthPct ?? measureTableWidthPct(editor) ?? DEFAULT_TABLE_LAYOUT.widthPct
  const padY = attrs?.cellPadY ?? DEFAULT_TABLE_LAYOUT.padY
  const padX = attrs?.cellPadX ?? DEFAULT_TABLE_LAYOUT.padX
  const rowH = attrs?.rowMinH ?? DEFAULT_TABLE_LAYOUT.minH

  const apply = (patch) => {
    if (!editor) return
    editor.chain().setLegalTableLayout(patch).run()
  }

  const isCustomized =
    attrs &&
    (attrs.tableWidthPct != null ||
      attrs.cellPadY != null ||
      attrs.cellPadX != null ||
      attrs.rowMinH != null)

  return (
    <div className="legal-template-editor__layout" ref={rootRef}>
      <button
        type="button"
        className={classNames('rich-text-editor__toolbar-btn', {
          'rich-text-editor__toolbar-btn--active': open,
        })}
        aria-expanded={open}
        title={labels.tableProperties}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="rich-text-editor__icon-table-props" aria-hidden="true" />
      </button>

      {showPanel ? (
        <div
          className="legal-template-editor__layout-panel legal-template-editor__layout-panel--table"
          role="dialog"
          aria-label={labels.tableProperties}
        >
          <section className="legal-template-editor__layout-section">
            <h6 className="legal-template-editor__layout-title">{labels.tableProperties}</h6>
            <NumberField
              id="tbl-width"
              label={labels.tableWidth}
              value={widthPct}
              min={10}
              max={100}
              step={1}
              suffix="%"
              onChange={(v) => apply({ tableWidthPct: v })}
            />
            <div className="legal-template-editor__layout-row">
              <NumberField
                id="tbl-pad-y"
                label={labels.cellPadY}
                value={padY}
                min={0}
                max={20}
                step={0.1}
                suffix="mm"
                onChange={(v) => apply({ cellPadY: v })}
              />
              <NumberField
                id="tbl-pad-x"
                label={labels.cellPadX}
                value={padX}
                min={0}
                max={20}
                step={0.1}
                suffix="mm"
                onChange={(v) => apply({ cellPadX: v })}
              />
            </div>
            <NumberField
              id="tbl-row-h"
              label={labels.rowHeight}
              value={rowH}
              min={0}
              max={100}
              step={1}
              suffix="mm"
              // 0 mm → null so the row falls back to its natural (auto) height.
              onChange={(v) => apply({ rowMinH: v > 0 ? v : null })}
            />
          </section>

          <div className="legal-template-editor__layout-actions">
            <button
              type="button"
              className="rich-text-editor__toolbar-btn"
              disabled={!isCustomized}
              onClick={() =>
                apply({ tableWidthPct: null, cellPadY: null, cellPadX: null, rowMinH: null })
              }
            >
              {labels.resetTable}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

TablePropertiesPanel.propTypes = {
  labels: PropTypes.object.isRequired,
  editor: PropTypes.object,
  disabled: PropTypes.bool,
  attrs: PropTypes.object,
}

export default TablePropertiesPanel
