/** Imported directly by path so the print/PDF path stays lazily loaded. */

export interface PdfPageOptions {
  title?: string
  pageSetup?: unknown
  /** Per-side page-margin overrides in mm. */
  marginsMm?: { top?: number; right?: number; bottom?: number; left?: number }
}

/**
 * The exact self-contained HTML document the PDF is printed from — content plus the print
 * stylesheet and the @page rule. Render it in an iframe (srcdoc) for a preview that is
 * literally the PDF's own markup rather than an approximation of it.
 */
export function buildPrintableDocument(html: string, options?: PdfPageOptions): string

export function exportHtmlToPdf(html: string, options?: PdfPageOptions): void
