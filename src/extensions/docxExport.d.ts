/** Imported directly by path so the heavy `docx` dependency stays lazily loaded. */
export function exportHtmlToDocx(
  html: string,
  options?: {
    fileName?: string
    font?: string
    fontSizePt?: number
    cellMargins?: { top?: number; bottom?: number; left?: number; right?: number }
    pageSetup?: unknown
    trackedChanges?: boolean
  },
): Promise<void>
