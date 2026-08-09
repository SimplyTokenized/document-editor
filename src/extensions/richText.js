/**
 * Rich-text HTML helpers used by the contract editor. Kept inside the module so it stays
 * self-contained and portable between apps (no import from the host app's utils).
 */

/**
 * @param {string|null|undefined} html
 * @returns {string}
 */
export function getRichTextPlainText(html) {
  if (html == null || typeof html !== 'string') return ''
  return html
    .replace(/<!--[\s\S]*?-->/g, '') // strip HTML comments
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|td|th|blockquote)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/​/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string|null|undefined} html
 * @returns {boolean}
 */
export function isRichTextContentEmpty(html) {
  return getRichTextPlainText(html).length === 0
}
