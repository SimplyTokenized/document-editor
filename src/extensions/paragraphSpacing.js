/**
 * Word's paragraph spacing — space before, space after, line spacing — as attributes on
 * paragraphs and headings, stored as the CSS they render to (`margin-top: 5pt`,
 * `margin-bottom: 5pt`, `line-height: 1.35`).
 *
 * Without these every imported paragraph took the editor's one house spacing (a 1.45 line
 * height and a fixed gap after), so a document that is tight in Word came out spread over
 * far more pages on screen and in the PDF. Now the .docx import resolves Word's spacing
 * through the style cascade and writes it here; the .docx export reads it back into
 * `w:spacing`; the print stylesheet gets it as inline style. Paragraphs without a value
 * keep the stylesheet defaults, so older templates look as they did.
 */
import { Extension } from '@tiptap/core'

/**
 * Word's line-spacing multiple is relative to the font's own line height (ascent + descent
 * + gap, about 1.17 em for Aptos, Calibri or Arial), CSS's unitless value to the font size.
 * `1.15` in Word is therefore about `1.35` in CSS; this factor converts in both directions.
 */
export const WORD_LINE_HEIGHT_FACTOR = 1.17

const SPACING_ATTRIBUTES = {
  marginTop: 'margin-top',
  marginBottom: 'margin-bottom',
  lineHeight: 'line-height',
}

export const ParagraphSpacing = Extension.create({
  name: 'paragraphSpacing',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: Object.fromEntries(
          Object.entries(SPACING_ATTRIBUTES).map(([name, property]) => [
            name,
            {
              default: null,
              parseHTML: (element) => element.style?.getPropertyValue(property) || null,
              renderHTML: (attributes) =>
                attributes[name] ? { style: `${property}: ${attributes[name]}` } : {},
            },
          ]),
        ),
      },
    ]
  },
})

export default ParagraphSpacing
