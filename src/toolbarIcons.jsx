/**
 * Line icons for the toolbar — inline SVG on a 24-unit grid, drawn in `currentColor`, so
 * they need no icon font or UI-kit dependency (this package ships into apps on CoreUI and
 * on shadcn alike) and read clearly at 16–18 px where the old glyph/CSS icons did not.
 */
import React from 'react'
import PropTypes from 'prop-types'

const TABLE = 'M3 5h18v14H3z M3 10h18 M3 15h18 M9 5v14 M15 5v14'

const PATHS = {
  quote: 'M10 11H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6a4 4 0 0 1-4 4 M20 11h-4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6a4 4 0 0 1-4 4',
  rule: 'M3 12h18 M7 7h10 M7 17h10',
  pageBreak: 'M6 3h9l4 4v3 M19 16v3a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-3 M3 13h3 M9 13h3 M15 13h3 M21 13h0',
  image: 'M3 5h18v14H3z M21 15l-5-5L5 21 M8.5 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  pen: 'M12 19l7-7 3 3-7 7-3-3z M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z M2 2l7.586 7.586 M11 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  table: TABLE,
  colBefore: 'M9 5h12v14H9z M9 10h12 M9 15h12 M15 5v14 M4 9v6 M1 12h6',
  colAfter: 'M3 5h12v14H3z M3 10h12 M3 15h12 M9 5v14 M20 9v6 M17 12h6',
  colDelete: `${TABLE} M10 3l4 -2.5 M10 8.5l4 -2.5`,
  rowBefore: 'M3 9h18v12H3z M3 15h18 M9 9v12 M15 9v12 M12 1v6 M9 4h6',
  rowAfter: 'M3 3h18v12H3z M3 9h18 M9 3v12 M15 3v12 M12 17v6 M9 20h6',
  rowDelete: `${TABLE} M1 12h4 M19 12h4`,
  tableDelete: 'M3 5h18v6H3 M3 5v14h8 M3 10h18 M3 15h8 M9 5v14 M15 5v6 M16 16l5 5 M21 16l-5 5',
  wrapNone: 'M4 4h16v6H4z M4 14h16 M4 18h16',
  wrapLeft: 'M4 5h7v9H4z M14 7h6 M14 11h6 M4 17h16 M4 21h16',
  wrapRight: 'M13 5h7v9h-7z M4 7h6 M4 11h6 M4 17h16 M4 21h16',
  tableProps: `${TABLE} M18.5 21.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z`,
}

// The strokes that should read as "cross this out" are drawn heavier than the grid.
const DELETE_MARKS = {
  colDelete: 'M10 8l4 8 M14 8l-4 8',
  rowDelete: 'M8 10l8 4 M16 10l-8 4',
}

export const Icon = ({ name, size = 18 }) => (
  <svg
    className="rich-text-editor__svg-icon"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d={PATHS[name]} />
    {DELETE_MARKS[name] ? <path d={DELETE_MARKS[name]} strokeWidth="2.25" /> : null}
  </svg>
)

Icon.propTypes = {
  name: PropTypes.oneOf(Object.keys(PATHS)).isRequired,
  size: PropTypes.number,
}

/** Icon with a caption beneath it — how the ribbon's Insert tab names its buttons. */
export const Captioned = ({ icon, caption }) => (
  <>
    <Icon name={icon} />
    <span className="rich-text-editor__btn-caption">{caption}</span>
  </>
)

Captioned.propTypes = {
  icon: PropTypes.string.isRequired,
  caption: PropTypes.node.isRequired,
}

export default Icon
