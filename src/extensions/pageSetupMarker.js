/**
 * Page-setup persistence marker, shared by every editor that touches a contract's `content`
 * HTML (TipTapEditor.js for authoring, ContractReviewEditor.js for the lawyer review/redline
 * flow).
 *
 * The page geometry (size + margins, twips) chosen in the Page & layout tool — or captured
 * from a .docx import — is embedded at the front of the emitted HTML as an HTML comment, so
 * it travels INSIDE the contract's saved content and survives save → reload without any
 * backend schema change. Every consumer of the content ignores comments (ProseMirror's
 * parser, dangerouslySetInnerHTML renders, getRichTextPlainText), so the marker is invisible
 * everywhere except here, where it's parsed back out. The JSON contains only numbers, so it
 * can never contain a premature "-->" terminator.
 */
const PAGE_SETUP_COMMENT_RE = /^\s*<!--\s*legal-page-setup:(\{.*?\})\s*-->\s*/

export const parsePageSetupMarker = (raw) => {
  const source = raw ?? ''
  const match = source.match(PAGE_SETUP_COMMENT_RE)
  if (!match) return { pageSetup: null, html: source }
  const html = source.slice(match[0].length)
  try {
    return { pageSetup: JSON.parse(match[1]), html }
  } catch {
    return { pageSetup: null, html }
  }
}

export const withPageSetupMarker = (html, pageSetup) =>
  pageSetup ? `<!--legal-page-setup:${JSON.stringify(pageSetup)}-->${html}` : html
