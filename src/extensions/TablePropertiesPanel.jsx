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

const NumberField = ({ id, label, value, min, max, step, suffix, onChange }) => (
  <label className="legal-template-editor__layout-field" htmlFor={id}>
    <span className="legal-template-editor__layout-field-label">{label}</span>
    <span className="legal-template-editor__layout-field-input">
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(clampNum(e.target.value, min, max))}
        // See PageLayoutPanel's NumberField: a focused number input silently changes value
        // on mouse-wheel scroll in Chrome — blur on wheel so scrolling the page never
        // accidentally resizes the table.
        onWheel={(e) => e.currentTarget.blur()}
      />
      {suffix ? <span className="legal-template-editor__layout-suffix">{suffix}</span> : null}
    </span>
  </label>
)

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
  const widthPct = attrs?.tableWidthPct ?? DEFAULT_TABLE_LAYOUT.widthPct
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
