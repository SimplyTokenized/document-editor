/**
 * Export the editor's HTML to PDF via the browser's own print engine (the user picks
 * "Save as PDF"). No heavyweight canvas/PDF library — the browser paginates a real A4 page
 * far better than a rasterizer would, and cell shading / fonts / numbering all come through
 * because they're inline on the HTML (shading) or replicated in the print stylesheet below.
 */

import { commonHeadingTextStyle, headingNumberStyleCss, headingNumbersFor } from './headingNumbers.js'
import { parsePageSetupMarker } from './pageSetupMarker.js'

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

/**
 * Stamp each numbered heading with its label (`data-heading-number`, drawn by the print
 * stylesheet) — the same numbers the editor shows, which the stored HTML does not carry.
 */
const numberHeadingsForPrint = (html) => {
  const parsed = new DOMParser().parseFromString(
    `<body><div id="r">${html || ''}</div></body>`,
    'text/html',
  )
  const root = parsed.getElementById('r')
  // The editor draws a line box for an empty block and one more after a trailing <br>
  // (ProseMirror's trailing break); a browser rendering the same HTML draws neither. A
  // zero-width space at the end gives print the same line, so the two paginate alike.
  root.querySelectorAll('p, h1, h2, h3, li, td, th, blockquote').forEach((el) => {
    const last = el.lastChild
    const blank = !el.textContent && !el.querySelector('img, table')
    if (blank || (last && last.nodeName === 'BR')) el.appendChild(parsed.createTextNode('​'))
  })
  headingNumbersFor(root).forEach((label, heading) => {
    heading.setAttribute('data-heading-number', label)
    // Same as the editor: the number takes the line's font/size/colour when it has one.
    const numberStyle = headingNumberStyleCss(commonHeadingTextStyle(heading))
    if (numberStyle) {
      heading.setAttribute('style', [heading.getAttribute('style'), numberStyle].filter(Boolean).join('; '))
    }
  })
  return root.innerHTML
}

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

// The on-screen paper's typography, value for value (contract-editor.scss, `.ProseMirror`
// inside `.legal-template-editor`, with 1rem = 16px): same font and size, same line height,
// same block spacing, same table insets. The editor's page view paginates from these
// metrics, so keeping them identical here is what makes its page breaks the PDF's page
// breaks. Cell shading is inline on the cells (data-background-color → style), so it just
// prints. Self-contained so the print document doesn't depend on the app's stylesheet.
// Same aliases as contract-editor.scss (see the comment there): Office's private fonts fall
// back to the closest face the browser can see, in print as on the paper.
const PRINT_FONT_ALIASES = `
  @font-face { font-family: 'Aptos'; src: local('Aptos'), local('Helvetica Neue'), local('Arial'); }
  @font-face { font-family: 'Aptos'; font-weight: bold; src: local('Aptos Bold'), local('Helvetica Neue Bold'), local('Arial Bold'); }
  @font-face { font-family: 'Aptos Display'; src: local('Aptos Display'), local('Aptos'), local('Helvetica Neue'), local('Arial'); }
  @font-face { font-family: 'Aptos Display'; font-weight: bold; src: local('Aptos Display Bold'), local('Aptos Bold'), local('Helvetica Neue Bold'), local('Arial Bold'); }
  @font-face { font-family: 'Calibri'; src: local('Calibri'), local('Carlito'), local('Helvetica Neue'), local('Arial'); }
  @font-face { font-family: 'Calibri'; font-weight: bold; src: local('Calibri Bold'), local('Carlito Bold'), local('Helvetica Neue Bold'), local('Arial Bold'); }
  @font-face { font-family: 'Cambria'; src: local('Cambria'), local('Caladea'), local('Georgia'), local('Times New Roman'); }
  @font-face { font-family: 'Cambria'; font-weight: bold; src: local('Cambria Bold'), local('Caladea Bold'), local('Georgia Bold'), local('Times New Roman Bold'); }
  @font-face { font-family: 'Segoe UI'; src: local('Segoe UI'), local('Helvetica Neue'), local('Arial'); }
  @font-face { font-family: 'Segoe UI'; font-weight: bold; src: local('Segoe UI Bold'), local('Helvetica Neue Bold'), local('Arial Bold'); }
`

const BODY_CSS = `
  ${PRINT_FONT_ALIASES}
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  body { margin: 0; }
  .doc {
    font-family: Arial, Helvetica, 'Helvetica Neue', sans-serif;
    font-size: 13.12px;
    line-height: 1.45;
    color: #212529;
    overflow-wrap: break-word;
  }
  .doc > :first-child { margin-top: 0; }
  .doc > :last-child { margin-bottom: 0; }
  .doc p { margin: 0 0 8px; }
  .doc h1 { font-size: 26.4px; font-weight: 600; margin: 13.6px 0 8.8px; }
  .doc h2 { font-size: 21.6px; font-weight: 600; margin: 12px 0 8px; }
  .doc h3 { font-size: 18.4px; font-weight: 600; margin: 10.4px 0 6.4px; }
  .doc [data-heading-number]::before { content: attr(data-heading-number) ' '; font-family: var(--heading-number-font-family, inherit); font-size: var(--heading-number-font-size, inherit); color: var(--heading-number-color, inherit); }
  .doc ul, .doc ol { margin: 8px 0; padding-left: 24px; }
  .doc ol { counter-reset: legal-item; list-style: none; padding-left: 28px; }
  .doc ol > li { position: relative; counter-increment: legal-item; }
  .doc ol > li::before { content: counters(legal-item, '.') '. '; position: absolute; left: -28px; min-width: 24px; font-weight: 600; }
  .doc blockquote { margin: 12px 0; padding: 8px 0 8px 16px; border-left: 3px solid #dee2e6; color: #6c757d; }
  .doc hr { margin: 16px 0; border: 0; border-top: 1px solid #dee2e6; }
  .doc code { padding: 1.6px 5.6px; border-radius: 4px; background: #f8f9fa; font-size: 0.875em; }
  .doc table { width: 100%; max-width: 100%; border-collapse: collapse; table-layout: fixed; margin: 16px 0; }
  .doc th, .doc td { border: 1px solid #dee2e6; padding: var(--legal-doc-cell-pad-y, 4.48px) var(--legal-doc-cell-pad-x, 6.4px); height: var(--legal-doc-cell-min-h, auto); vertical-align: top; overflow-wrap: anywhere; word-break: break-word; }
  .doc th { background: #f8f9fa; font-weight: 600; text-align: left; }
  .doc table p { margin-bottom: 5.6px; }
  .doc table p:last-child { margin-bottom: 0; }
  .doc [data-page-break-before] { page-break-before: always; break-before: page; }
  .doc table[data-legal-borderless] th, .doc table[data-legal-borderless] td, .doc th[data-legal-borderless], .doc td[data-legal-borderless] { border-color: transparent; }
  .doc img { max-width: 100%; height: auto; margin: 8px 0; }
  .doc a { color: #5856d6; text-decoration: underline; }
`

/**
 * Screen-only styling for the printable document, used when it is shown in an iframe as a
 * preview. `@page` governs paper geometry when PRINTING and does nothing on screen, so
 * without this the preview would render as one continuous column and look nothing like the
 * PDF. Here the same page width and margins are reproduced as a centred white sheet on a
 * grey backdrop, with a repeating band marking where each page ends.
 *
 * It is a faithful preview of geometry, not a paginator: the browser cannot reflow content
 * onto discrete sheets on screen, so a block that straddles a break is drawn across the band
 * rather than pushed to the next page the way the real print engine will.
 */
const screenCss = (pageSetup, marginsMm = {}) => {
  const w = pageSetup?.size?.width
  const h = pageSetup?.size?.height
  const m = pageSetup?.margins || {}
  const sideMm = (key, fallback) =>
    Number.isFinite(marginsMm[key])
      ? marginsMm[key]
      : Number.isFinite(m[key])
        ? m[key] / TWIPS_PER_MM
        : fallback
  const pageWmm = w ? w / TWIPS_PER_MM : 210
  const pageHmm = h ? h / TWIPS_PER_MM : 297
  const top = sideMm('top', 20)
  const right = sideMm('right', 20)
  const bottom = sideMm('bottom', 20)
  const left = sideMm('left', 20)
  // Height of one page's content box — where a break falls, measured from the sheet's top.
  const contentHmm = Math.max(1, pageHmm - top - bottom)

  return `
  @media screen {
    html { background: #f1f1f4; }
    body { margin: 0; padding: 24px 0; }
    .doc {
      width: ${pageWmm}mm;
      min-height: ${pageHmm}mm;
      margin: 0 auto;
      padding: ${top}mm ${right}mm ${bottom}mm ${left}mm;
      background: #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08);
      background-image: repeating-linear-gradient(
        to bottom,
        transparent 0,
        transparent calc(${contentHmm}mm - 1px),
        rgba(0,0,0,0.14) calc(${contentHmm}mm - 1px),
        rgba(0,0,0,0.14) ${contentHmm}mm,
        transparent ${contentHmm}mm
      );
      background-origin: content-box;
      background-clip: content-box;
      background-repeat: repeat-y;
    }
  }
`
}

/**
 * Build the exact self-contained HTML document the PDF is printed from — the content plus
 * the print stylesheet and the @page rule derived from the document's own page setup.
 *
 * Exported so a host can render it in an iframe for a true "this is the PDF" preview,
 * instead of approximating the paged output with app styles.
 *
 * @param {string} html - the editor's serialized content (contract_content). The page-setup
 *   marker the editor embeds in it is read here, so a host need not pass `pageSetup`.
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {{size?:{width,height},margins?:{top,right,bottom,left}}} [options.pageSetup] - page
 *   size + margins (twips); overrides the marker in the content.
 * @param {{top?:number,right?:number,bottom?:number,left?:number}} [options.marginsMm] -
 *   per-side page-margin overrides in mm. None by default: the PDF uses the document's own
 *   margins, the same ones the editor's paper and page view are laid out with.
 */
export function buildPrintableDocument(html, { title = 'Contract', pageSetup, marginsMm = {} } = {}) {
  const marker = parsePageSetupMarker(html)
  const setup = pageSetup ?? marker.pageSetup
  const css = `${pageRule(setup, marginsMm)}\n${BODY_CSS}\n${screenCss(setup, marginsMm)}`
  const body = numberHeadingsForPrint(normalizeTablesForPrint(marker.html))
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
    `<style>${css}</style></head><body><div class="doc">${body}</div></body></html>`
  )
}

/**
 * Print (→ "Save as PDF") the document produced by buildPrintableDocument.
 *
 * There is no PDF blob anywhere in here: this hands the document to the browser's own print
 * engine and the user picks the destination. That is also why an on-screen preview should
 * render `buildPrintableDocument` rather than a separately-styled copy — same HTML, same
 * stylesheet, same @page rule, so what the reader sees is what the PDF will be.
 */
export function exportHtmlToPdf(html, { title = 'Contract', pageSetup, marginsMm = {} } = {}) {
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

  const doc = iframe.contentDocument
  doc.open()
  doc.write(buildPrintableDocument(html, { title, pageSetup, marginsMm }))
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
