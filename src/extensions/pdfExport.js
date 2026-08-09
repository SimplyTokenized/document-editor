/**
 * Export the editor's HTML to PDF via the browser's own print engine (the user picks
 * "Save as PDF"). No heavyweight canvas/PDF library — the browser paginates a real A4 page
 * far better than a rasterizer would, and cell shading / fonts / numbering all come through
 * because they're inline on the HTML (shading) or replicated in the print stylesheet below.
 */

const TWIPS_PER_MM = 56.6929 // 1mm = 1440/25.4 twips
const mm = (twips) => `${(twips / TWIPS_PER_MM).toFixed(2)}mm`

/**
 * Rewrite each table's fixed pixel column widths (from the imported source, on cells'
 * `colwidth`) into PERCENTAGES via a <colgroup>, and set the table to width:100%. Without
 * this the table renders at its intrinsic pixel width and leaves a big right-hand gap — it
 * must fill the printable area while keeping the source's column ratios.
 */
const normalizeTablesForPrint = (html) => {
  const parsed = new DOMParser().parseFromString(
    `<body><div id="r">${html || ''}</div></body>`,
    'text/html',
  )
  parsed.querySelectorAll('table').forEach((table) => {
    const rows = Array.from(table.rows) // table.rows excludes nested-table rows
    let colCount = 0
    rows.forEach((row) => {
      let c = 0
      Array.from(row.cells).forEach((cell) => (c += cell.colSpan || 1))
      colCount = Math.max(colCount, c)
    })
    if (colCount < 1) return

    const px = new Array(colCount).fill(0)
    rows.forEach((row) => {
      let ci = 0
      Array.from(row.cells).forEach((cell) => {
        const span = cell.colSpan || 1
        const cw = (cell.getAttribute('colwidth') || '')
          .split(',')
          .map((n) => parseInt(n, 10))
          .filter((n) => Number.isFinite(n) && n > 0)
        for (let i = 0; i < span; i += 1) {
          if (cw[i] && !px[ci + i]) px[ci + i] = cw[i]
        }
        ci += span
      })
    })

    const total = px.reduce((sum, w) => sum + w, 0)
    table.style.width = '100%'
    if (total > 0 && px.every((w) => w > 0)) {
      const existing = table.querySelector('colgroup')
      if (existing) existing.remove()
      const colgroup = parsed.createElement('colgroup')
      px.forEach((w) => {
        const col = parsed.createElement('col')
        col.style.width = `${((w / total) * 100).toFixed(3)}%`
        colgroup.appendChild(col)
      })
      table.insertBefore(colgroup, table.firstChild)
    }
  })
  return parsed.getElementById('r').innerHTML
}

// Default PDF top margin (mm). The imported source often reserves a large top margin for a
// page header we don't render, which leaves an oversized gap once headers are off — so the
// PDF top defaults to this smaller value. Override per export via options.marginsMm.top.
const DEFAULT_PDF_TOP_MM = 8

/**
 * Build the @page rule from the source document's page geometry (twips) so the PDF has the
 * SAME page size + margins as the imported .docx, with optional per-side mm overrides.
 * Falls back to A4 / 2cm when authored from scratch. NOTE: the browser's own "Margins"
 * dropdown must be "Default"/"Standard" for these CSS margins to apply — "None" forces 0.
 *
 * @param {object} pageSetup - { size:{width,height}, margins:{top,right,bottom,left} } in twips
 * @param {{top?:number,right?:number,bottom?:number,left?:number}} [marginsMm] - mm overrides
 */
const pageRule = (pageSetup, marginsMm = {}) => {
  const w = pageSetup?.size?.width
  const h = pageSetup?.size?.height
  const m = pageSetup?.margins || {}
  const size = w && h ? `size: ${mm(w)} ${mm(h)};` : 'size: A4;'

  // Each side: explicit mm override wins, else the source's own margin, else a fallback.
  const side = (key, fallbackMm) =>
    Number.isFinite(marginsMm[key])
      ? `${marginsMm[key]}mm`
      : Number.isFinite(m[key])
        ? mm(m[key])
        : `${fallbackMm}mm`

  const margin = `margin: ${side('top', 20)} ${side('right', 20)} ${side('bottom', 20)} ${side('left', 20)};`
  return `@page { ${size} ${margin} }`
}

// Mirrors the on-screen paper: Arial, automatic heading/list numbering, table borders.
// Cell background shading is inline on the cells (data-background-color → style), so it just
// prints. Kept self-contained so the print document doesn't depend on the app's stylesheet.
const BODY_CSS = `
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  body { margin: 0; }
  .doc {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8pt;
    line-height: 1.45;
    color: #000;
    counter-reset: legal-h2;
  }
  .doc h1 { font-size: 13pt; font-weight: 700; margin: 0 0 6pt; }
  .doc h2 { font-size: 11pt; font-weight: 700; margin: 8pt 0 4pt; counter-reset: legal-h3; counter-increment: legal-h2; }
  .doc h2::before { content: counter(legal-h2) '. '; }
  .doc h3 { font-size: 9.5pt; font-weight: 700; margin: 6pt 0 3pt; counter-increment: legal-h3; }
  .doc h3::before { content: counter(legal-h2) '.' counter(legal-h3) ' '; }
  .doc p { margin: 0 0 4pt; }
  .doc ol { counter-reset: legal-item; list-style: none; padding-left: 16pt; }
  .doc ol > li { position: relative; counter-increment: legal-item; }
  .doc ol > li::before { content: counters(legal-item, '.') '. '; position: absolute; left: -16pt; font-weight: 600; }
  .doc ul { padding-left: 16pt; }
  .doc table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 6pt 0; }
  .doc th, .doc td { border: 0.5pt solid #999; padding: 2pt 3pt; vertical-align: top; overflow-wrap: anywhere; }
  .doc img { max-width: 100%; height: auto; }
  .doc a { color: #06c; text-decoration: underline; }
`

/**
 * @param {string} html - the editor's serialized content (contract_content)
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {{size?:{width,height},margins?:{top,right,bottom,left}}} [options.pageSetup] - page
 *   size + margins (twips) from the imported source so the PDF matches the source geometry.
 * @param {{top?:number,right?:number,bottom?:number,left?:number}} [options.marginsMm] -
 *   per-side page-margin overrides in mm (top defaults to DEFAULT_PDF_TOP_MM).
 */
export function exportHtmlToPdf(
  html,
  { title = 'Contract', pageSetup, marginsMm = { top: DEFAULT_PDF_TOP_MM } } = {},
) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    visibility: 'hidden',
  })
  document.body.appendChild(iframe)

  const css = `${pageRule(pageSetup, marginsMm)}\n${BODY_CSS}`
  const body = normalizeTablesForPrint(html)
  const doc = iframe.contentDocument
  doc.open()
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
      `<style>${css}</style></head><body><div class="doc">${body}</div></body></html>`,
  )
  doc.close()

  const cleanup = () => {
    // Give the print dialog time to grab the document before removing the iframe.
    setTimeout(() => iframe.remove(), 1000)
  }

  // Let layout + fonts settle, then print.
  const printWindow = iframe.contentWindow
  const run = () => {
    printWindow.focus()
    printWindow.print()
    cleanup()
  }
  if (doc.readyState === 'complete') {
    setTimeout(run, 250)
  } else {
    iframe.onload = () => setTimeout(run, 250)
  }
}
