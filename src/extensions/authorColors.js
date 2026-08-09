/** Per-author color palette for track changes (Word-style). */
export const AUTHOR_COLORS = [
  { insertion: 'hsl(142 76% 36%)', deletion: 'hsl(142 76% 36%)', bg: 'hsl(142 76% 95%)' },
  { insertion: 'hsl(217 91% 45%)', deletion: 'hsl(217 91% 45%)', bg: 'hsl(217 91% 95%)' },
  { insertion: 'hsl(25 95% 47%)', deletion: 'hsl(25 95% 47%)', bg: 'hsl(25 95% 95%)' },
  { insertion: 'hsl(262 83% 52%)', deletion: 'hsl(262 83% 52%)', bg: 'hsl(262 83% 95%)' },
  { insertion: 'hsl(196 89% 44%)', deletion: 'hsl(196 89% 44%)', bg: 'hsl(196 89% 95%)' },
  { insertion: 'hsl(173 80% 40%)', deletion: 'hsl(173 80% 40%)', bg: 'hsl(173 80% 95%)' },
]

function hashAuthor(author) {
  let h = 0
  for (let i = 0; i < author.length; i++) {
    h = (h << 5) - h + author.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

/** Returns 0–5 for consistent author color mapping */
export function getAuthorColorIndex(author) {
  if (!author || author === 'Unknown') return 0
  return hashAuthor(author) % AUTHOR_COLORS.length
}
