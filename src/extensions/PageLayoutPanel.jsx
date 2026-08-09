/**
 * Page setup tool for the contract authoring editor — a popover that lets the author set
 * the page size and margins ("distance"), in millimetres (the unit Word uses in EU/German
 * locales).
 *
 * Page geometry is stored back into the existing `pageSetup` shape (twips:
 * `{ size:{width,height}, margins:{top,right,bottom,left} }`) so it flows straight into the
 * on-screen paper (via buildLayoutVars → CSS vars on the editor root), the page-break
 * guides, and the .docx / PDF export — exactly like an imported document's page setup does,
 * and overriding it when the author edits after an import.
 *
 * `pageSetup` is `null` until first edited (or set from a .docx import), so an untouched
 * document keeps the default A4 look from the stylesheet. Per-table sizing lives separately
 * on each table node (see legalTable.js + TablePropertiesPanel.js).
 */
import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import classNames from 'classnames'

// 1 inch = 1440 twips = 25.4 mm = 96 CSS px. Keep both conversions in one place so the
// on-screen paper (px) and the exported document (twips) agree on how big a millimetre is.
export const TWIPS_PER_MM = 1440 / 25.4
export const PX_PER_MM = 96 / 25.4

export const mmToTwips = (mm) => Math.round(mm * TWIPS_PER_MM)
export const twipsToMm = (twips) => Math.round((twips / TWIPS_PER_MM) * 10) / 10

// A4, matching the DEFAULT_PAGE used by docxExport and the A4 fallback in TipTapEditor.
export const DEFAULT_PAGE_TWIPS = {
  size: { width: 11906, height: 16838 },
  margins: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
}

// Defaults for the table model, chosen to match the base table CSS (padding
// 0.28rem/0.4rem ≈ 1.2mm/1.7mm, full-width table, natural row height).
export const DEFAULT_TABLE_LAYOUT = {
  widthPct: 100,
  padY: 1.2,
  padX: 1.7,
  minH: 0,
}

const PAGE_PRESETS = [
  { key: 'a4', w: 210, h: 297 },
  { key: 'letter', w: 215.9, h: 279.4 },
  { key: 'legal', w: 215.9, h: 355.6 },
]

const nearly = (a, b) => Math.abs(a - b) < 0.6

const matchPreset = (wMm, hMm) => {
  const hit = PAGE_PRESETS.find((p) => nearly(p.w, wMm) && nearly(p.h, hMm))
  return hit ? hit.key : 'custom'
}

// Effective page geometry in mm — the stored pageSetup merged over A4 defaults.
const pageToMm = (pageSetup) => {
  const size = { ...DEFAULT_PAGE_TWIPS.size, ...(pageSetup?.size || {}) }
  const margins = { ...DEFAULT_PAGE_TWIPS.margins, ...(pageSetup?.margins || {}) }
  return {
    w: twipsToMm(size.width),
    h: twipsToMm(size.height),
    top: twipsToMm(margins.top),
    right: twipsToMm(margins.right),
    bottom: twipsToMm(margins.bottom),
    left: twipsToMm(margins.left),
  }
}

const mmToPage = (mm) => ({
  size: { width: mmToTwips(mm.w), height: mmToTwips(mm.h) },
  margins: {
    top: mmToTwips(mm.top),
    right: mmToTwips(mm.right),
    bottom: mmToTwips(mm.bottom),
    left: mmToTwips(mm.left),
  },
})

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

const NumberField = ({ id, label, value, min, max, step, suffix, onChange, disabled }) => {
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
          disabled={disabled}
          onChange={(e) => onInput(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit(e.currentTarget.value)
            }
          }}
        // Chrome (and other browsers) silently increment/decrement a focused number input on
        // mouse-wheel scroll — blur on wheel so scrolling always just scrolls.
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
  disabled: PropTypes.bool,
}

const PageLayoutPanel = ({ labels, pageSetup, onPageSetup }) => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  // Close on outside click / Escape while open.
  useEffect(() => {
    if (!open) return undefined
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
  }, [open])

  const mm = pageToMm(pageSetup)
  const preset = matchPreset(mm.w, mm.h)

  const commitPage = (nextMm) => onPageSetup(mmToPage(nextMm))

  const handlePreset = (key) => {
    if (key === 'custom') return
    const p = PAGE_PRESETS.find((x) => x.key === key)
    if (p) commitPage({ ...mm, w: p.w, h: p.h })
  }

  const isDefault = !pageSetup

  return (
    <div className="legal-template-editor__layout" ref={rootRef}>
      <button
        type="button"
        className={classNames('rich-text-editor__toolbar-btn', {
          'rich-text-editor__toolbar-btn--active': open,
        })}
        aria-expanded={open}
        title={labels.layout}
        onClick={() => setOpen((v) => !v)}
      >
        {/* Icon-only: this sits in the view-controls group next to page guides and
            fullscreen, where the labels were most of what pushed the actions bar onto a
            second row. The title attribute carries the name. */}
        <span className="rich-text-editor__icon-layout" aria-hidden="true" />
      </button>

      {open ? (
        <div
          className="legal-template-editor__layout-panel"
          role="dialog"
          aria-label={labels.layout}
        >
          <section className="legal-template-editor__layout-section">
            <h6 className="legal-template-editor__layout-title">{labels.pageSize}</h6>
            <label className="legal-template-editor__layout-field" htmlFor="page-preset">
              <span className="legal-template-editor__layout-field-label">{labels.preset}</span>
              <select
                id="page-preset"
                className="legal-template-editor__layout-select"
                value={preset}
                onChange={(e) => handlePreset(e.target.value)}
              >
                <option value="a4">{labels.presetA4}</option>
                <option value="letter">{labels.presetLetter}</option>
                <option value="legal">{labels.presetLegal}</option>
                <option value="custom">{labels.presetCustom}</option>
              </select>
            </label>
            <div className="legal-template-editor__layout-row">
              <NumberField
                id="page-w"
                label={labels.width}
                value={mm.w}
                min={50}
                max={2000}
                step={1}
                suffix="mm"
                onChange={(v) => commitPage({ ...mm, w: v })}
              />
              <NumberField
                id="page-h"
                label={labels.height}
                value={mm.h}
                min={50}
                max={2000}
                step={1}
                suffix="mm"
                onChange={(v) => commitPage({ ...mm, h: v })}
              />
            </div>
          </section>

          <section className="legal-template-editor__layout-section">
            <h6 className="legal-template-editor__layout-title">{labels.margins}</h6>
            <div className="legal-template-editor__layout-row">
              <NumberField
                id="margin-top"
                label={labels.marginTop}
                value={mm.top}
                min={0}
                max={100}
                step={1}
                suffix="mm"
                onChange={(v) => commitPage({ ...mm, top: v })}
              />
              <NumberField
                id="margin-bottom"
                label={labels.marginBottom}
                value={mm.bottom}
                min={0}
                max={100}
                step={1}
                suffix="mm"
                onChange={(v) => commitPage({ ...mm, bottom: v })}
              />
            </div>
            <div className="legal-template-editor__layout-row">
              <NumberField
                id="margin-left"
                label={labels.marginLeft}
                value={mm.left}
                min={0}
                max={100}
                step={1}
                suffix="mm"
                onChange={(v) => commitPage({ ...mm, left: v })}
              />
              <NumberField
                id="margin-right"
                label={labels.marginRight}
                value={mm.right}
                min={0}
                max={100}
                step={1}
                suffix="mm"
                onChange={(v) => commitPage({ ...mm, right: v })}
              />
            </div>
          </section>

          <div className="legal-template-editor__layout-actions">
            <button
              type="button"
              className="rich-text-editor__toolbar-btn"
              disabled={isDefault}
              onClick={() => onPageSetup(null)}
            >
              {labels.resetLayout}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

PageLayoutPanel.propTypes = {
  labels: PropTypes.object.isRequired,
  pageSetup: PropTypes.object,
  onPageSetup: PropTypes.func.isRequired,
}

// CSS custom properties for the editor root that size the on-screen paper. ALWAYS emitted
// (from the stored pageSetup merged over A4 defaults) so the paper renders exactly the size
// and margins the Page-setup tool shows — including a real 0 mm margin — instead of silently
// falling back to a different stylesheet default that never matched the displayed numbers.
// Table sizing is NOT here — it lives on each table node (legalTable.js) so tables are sized
// independently.
export const buildLayoutVars = (pageSetup) => {
  const size = { ...DEFAULT_PAGE_TWIPS.size, ...(pageSetup?.size || {}) }
  const margins = { ...DEFAULT_PAGE_TWIPS.margins, ...(pageSetup?.margins || {}) }
  const px = (twips) => `${Math.round(twipsToMm(twips) * PX_PER_MM)}px`
  return {
    '--legal-page-width': px(size.width),
    '--legal-page-pad-top': px(margins.top),
    '--legal-page-pad-right': px(margins.right),
    '--legal-page-pad-bottom': px(margins.bottom),
    '--legal-page-pad-left': px(margins.left),
  }
}

export default PageLayoutPanel
