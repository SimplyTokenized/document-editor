/**
 * Redline diff — turn a plain (untracked) edited document into tracked changes by comparing it
 * against the current base document.
 *
 * Used when a reviewer edits the contract in Word WITHOUT Track Changes on: on import we diff
 * the new content against what the editor currently holds and materialize the difference as
 * <ins>/<del> marks, so the redline shows up exactly as if the edits had been tracked.
 *
 * The diff is STRUCTURAL: it walks the two documents in parallel, matching block elements
 * (paragraphs, headings, list items) and containers (tables, rows, cells, lists) so a table's
 * shape is preserved — only the text inside changed leaf blocks is diffed word-by-word. New
 * blocks become insertions, missing blocks become deletions.
 */

const BLOCKISH = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
  'UL',
  'OL',
  'BLOCKQUOTE',
  'DIV',
  'HR',
])

const elementChildren = (node) => Array.from(node.childNodes).filter((n) => n.nodeType === 1)

/** A container holds block-level children (table/row/cell/list) → recurse; else it's a leaf. */
const isContainer = (node) => elementChildren(node).some((c) => BLOCKISH.has(c.tagName))

const normText = (node) => (node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()

const escapeHtml = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeAttr = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')

const insOpen = (author) => `<ins class="legal-insertion" data-author="${escapeAttr(author)}">`
const delOpen = (author) => `<del class="legal-deletion" data-author="${escapeAttr(author)}">`
const insWrap = (author, inner) => (inner ? `${insOpen(author)}${inner}</ins>` : '')
const delWrap = (author, inner) => (inner ? `${delOpen(author)}${inner}</del>` : '')

/** Opening tag with the node's original attributes preserved (colspan, colwidth, style, …). */
const openTag = (node) => {
  const attrs = Array.from(node.attributes || [])
    .map((a) => ` ${a.name}="${escapeAttr(a.value)}"`)
    .join('')
  return `<${node.tagName.toLowerCase()}${attrs}>`
}
const closeTag = (node) => `</${node.tagName.toLowerCase()}>`

/** Word-set overlap — used to decide whether two leaf blocks are "the same paragraph, edited". */
const similarity = (a, b) => {
  const ta = normText(a)
  const tb = normText(b)
  if (ta === tb) return 1
  if (!ta || !tb) return 0
  const wa = new Set(ta.split(' '))
  const wb = new Set(tb.split(' '))
  let shared = 0
  wa.forEach((w) => {
    if (wb.has(w)) shared += 1
  })
  return shared / Math.max(wa.size, wb.size)
}

/** Do two nodes represent the same slot? Containers match by tag; leaves by text similarity. */
const nodesMatch = (a, b) => {
  if (a.tagName !== b.tagName) return false
  if (isContainer(a) && isContainer(b)) return true
  return similarity(a, b) >= 0.5
}

/**
 * Longest-common-subsequence alignment of two node lists → an ordered op list of
 * { type: 'equal'|'ins'|'del', base, cur }. Classic edit-distance backtrace over `match`.
 */
const alignChildren = (base, cur) => {
  const n = base.length
  const m = cur.length
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = nodesMatch(base[i], cur[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (nodesMatch(base[i], cur[j])) {
      ops.push({ type: 'equal', base: base[i], cur: cur[j] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', base: base[i] })
      i += 1
    } else {
      ops.push({ type: 'ins', cur: cur[j] })
      j += 1
    }
  }
  while (i < n) {
    ops.push({ type: 'del', base: base[i] })
    i += 1
  }
  while (j < m) {
    ops.push({ type: 'ins', cur: cur[j] })
    j += 1
  }
  return ops
}

/** Wrap every leaf block inside `node` as fully inserted / deleted, keeping structure. */
const markWhole = (node, kind, author) => {
  if (isContainer(node)) {
    const inner = elementChildren(node)
      .map((c) => markWhole(c, kind, author))
      .join('')
    return `${openTag(node)}${inner}${closeTag(node)}`
  }
  const body = node.innerHTML
  const wrapped = kind === 'ins' ? insWrap(author, body) : delWrap(author, body)
  return `${openTag(node)}${wrapped}${closeTag(node)}`
}

/** Split into words + whitespace runs so a rebuilt paragraph keeps its spacing. */
const tokenize = (text) => (text ? text.match(/\s+|[^\s]+/g) || [] : [])

/** Word-level LCS diff of two plain strings → inline HTML with <ins>/<del> for the changes. */
const diffWords = (baseText, curText, author) => {
  const a = tokenize(baseText)
  const b = tokenize(curText)
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  // Emit, coalescing consecutive same-op tokens into one <ins>/<del>/plain run.
  let html = ''
  let pending = { type: null, text: '' }
  const flush = () => {
    if (!pending.text) return
    if (pending.type === 'ins') html += insWrap(author, escapeHtml(pending.text))
    else if (pending.type === 'del') html += delWrap(author, escapeHtml(pending.text))
    else html += escapeHtml(pending.text)
    pending = { type: null, text: '' }
  }
  const push = (type, text) => {
    if (pending.type !== type) flush()
    pending.type = type
    pending.text += text
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', b[j])
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('del', a[i])
      i += 1
    } else {
      push('ins', b[j])
      j += 1
    }
  }
  while (i < n) {
    push('del', a[i])
    i += 1
  }
  while (j < m) {
    push('ins', b[j])
    j += 1
  }
  flush()
  return html
}

/** Diff a matched pair of nodes (same slot) → the new node's tag with redlined content. */
const diffPair = (baseNode, curNode, author) => {
  if (isContainer(curNode) && isContainer(baseNode)) {
    return `${openTag(curNode)}${diffChildren(baseNode, curNode, author)}${closeTag(curNode)}`
  }
  // Leaf block: identical text keeps the new node verbatim (formatting preserved); otherwise
  // rebuild from a word diff (inline formatting is simplified to plain text on changed lines).
  if (normText(baseNode) === normText(curNode)) {
    return `${openTag(curNode)}${curNode.innerHTML}${closeTag(curNode)}`
  }
  const inner = diffWords(baseNode.textContent || '', curNode.textContent || '', author)
  return `${openTag(curNode)}${inner}${closeTag(curNode)}`
}

function diffChildren(baseParent, curParent, author) {
  const ops = alignChildren(elementChildren(baseParent), elementChildren(curParent))
  let html = ''
  for (const op of ops) {
    if (op.type === 'equal') html += diffPair(op.base, op.cur, author)
    else if (op.type === 'ins') html += markWhole(op.cur, 'ins', author)
    else html += markWhole(op.base, 'del', author)
  }
  return html
}

/** Resolve a redlined document to its accepted text (keep insertions, drop deletions). */
export const acceptedHtml = (html) =>
  String(html || '')
    .replace(/<del\b[^>]*>[\s\S]*?<\/del>/gi, '')
    .replace(/<ins\b[^>]*>([\s\S]*?)<\/ins>/gi, '$1')

/**
 * @param {string} baseHtml - the current document (its accepted text is used as the base)
 * @param {string} newHtml  - the imported, edited document
 * @param {string} author   - who to attribute the generated tracked changes to
 * @returns {string} redline HTML (base structure updated to the new content, with <ins>/<del>)
 */
export function diffHtmlToRedline(baseHtml, newHtml, author = 'Reviewer') {
  const parse = (html) => new DOMParser().parseFromString(html || '<p></p>', 'text/html').body
  const baseBody = parse(acceptedHtml(baseHtml))
  const newBody = parse(newHtml)
  return diffChildren(baseBody, newBody, author)
}
