/**
 * Vector illustration — a block that holds a real W3C `<svg>` and opens SVG-Edit's
 * headless canvas to draw and reshape it.
 *
 * Stored HTML (what `renderHTML` writes and `parseHTML` reads):
 *
 *   <figure data-vector-illustration="1" data-align="center" style="…">
 *     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">…</svg>
 *   </figure>
 *
 * The SVG is emitted as structure, not as an escaped string, so every read-only view — the
 * editor in `editable={false}`, a host's `dangerouslySetInnerHTML`, the print stylesheet —
 * renders it with no JavaScript. The `svg` attribute is the drawing's single source of
 * truth and is always sanitised (vectorSvg.js) before it is stored.
 *
 * Editing happens in a workspace the node view opens IN PLACE of the preview. Only one
 * illustration per editor can be in the workspace at a time (plugin state `editingPos`):
 * SVG-Edit's canvas has no dispose, hard-codes a few element ids and registers a window
 * listener per instance, so it is created once per workspace and torn down with it — see
 * vectorWorkspace/VectorWorkspace.jsx.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { DEFAULT_ARTBOARD, VECTOR_ATTR, emptyArtboard, sanitizeSvg, svgToElement } from './vectorSvg.js'
import { normalizeWrap, parseWrapFromElement, vectorPresentationStyle } from './vectorLayout.js'
import VectorIllustrationView from './vectorWorkspace/VectorIllustrationView.jsx'
import { VECTOR_ILLUSTRATION_NAME, getVectorWorkspacePos, vectorWorkspaceKey } from './vectorWorkspace/workspaceState.js'

export { VECTOR_ILLUSTRATION_NAME, getVectorWorkspacePos, vectorWorkspaceKey }
const WORKSPACE_CLASS = 'legal-vector-workspace'

const pixels = (value) => {
  const n = Number.parseInt(String(value ?? '').replace(/px$/i, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** The SVG source inside a matched element — the figure's child, or the element itself. */
const svgSourceOf = (element) => {
  if (element.localName === 'svg') return element.outerHTML
  const svg = element.querySelector('svg')
  return svg ? svg.outerHTML : ''
}

export const VectorIllustration = Node.create({
  name: VECTOR_ILLUSTRATION_NAME,
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return {
      /** Label overrides for the node view and workspace (see DEFAULT_LABELS there). */
      labels: {},
    }
  },

  addStorage() {
    // `canvas` is the live SVG-Edit instance while a workspace is open (set by it), null otherwise.
    return { labels: this.options.labels, canvas: null }
  },

  addAttributes() {
    return {
      svg: {
        default: '',
        parseHTML: (element) => sanitizeSvg(svgSourceOf(element))?.svg ?? '',
        renderHTML: () => ({}),
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const svg = element.localName === 'svg' ? element : element.querySelector('svg')
          return pixels(element.style?.width) || pixels(svg?.getAttribute('width')) || null
        },
        renderHTML: () => ({}),
      },
      height: {
        default: null,
        parseHTML: (element) => {
          const svg = element.localName === 'svg' ? element : element.querySelector('svg')
          return pixels(element.style?.height) || pixels(svg?.getAttribute('height')) || null
        },
        renderHTML: () => ({}),
      },
      align: {
        default: 'center',
        parseHTML: (element) => {
          const value = element.getAttribute('data-align')
          return value === 'left' || value === 'right' ? value : 'center'
        },
        renderHTML: () => ({}),
      },
      /** How text treats the block: 'none' (above/below), 'left' or 'right' (wraps around). */
      wrap: {
        default: 'none',
        parseHTML: (element) => parseWrapFromElement(element),
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [
      { tag: `figure[${VECTOR_ATTR}]`, priority: 60, getAttrs: (el) => (svgSourceOf(el) ? null : false) },
      // A bare <svg> — pasted, or a picture the .docx import wrote before the wrapper existed.
      { tag: 'svg', priority: 55, getAttrs: (el) => (sanitizeSvg(el.outerHTML) ? null : false) },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const { svg, width, height, align, wrap } = node.attrs
    const attrs = mergeAttributes(HTMLAttributes, {
      [VECTOR_ATTR]: '1',
      'data-align': align,
      'data-wrap': normalizeWrap(wrap),
      style: vectorPresentationStyle({ align, width, height, wrap }),
    })
    // No DOM (server-side rendering of the schema): fall back to a bare wrapper.
    if (typeof document === 'undefined') return ['figure', attrs]
    const figure = document.createElement('figure')
    Object.entries(attrs).forEach(([name, value]) => {
      if (value != null && value !== false) figure.setAttribute(name, String(value))
    })
    const svgEl = svgToElement(svg, { width, height })
    if (svgEl) figure.appendChild(svgEl)
    return figure
  },

  addCommands() {
    return {
      /** Insert a blank artboard (or the given SVG) and open it in the workspace. */
      insertVectorIllustration:
        ({ svg, width = DEFAULT_ARTBOARD.width, height = DEFAULT_ARTBOARD.height } = {}) =>
        ({ tr, state, dispatch }) => {
          const clean = sanitizeSvg(svg || emptyArtboard(width, height))
          if (!clean) return false
          const node = state.schema.nodes[VECTOR_ILLUSTRATION_NAME].create({
            svg: clean.svg,
            width: clean.width,
            height: clean.height,
          })
          const pos = tr.selection.$from.after(1)
          if (dispatch) {
            tr.insert(pos, node).setMeta(vectorWorkspaceKey, { open: pos })
          }
          return true
        },
      /** Replace the illustration at `pos` (used by the workspace's Apply). */
      updateVectorIllustration:
        (pos, attrs) =>
        ({ tr, state, dispatch }) => {
          const node = state.doc.nodeAt(pos)
          if (!node || node.type.name !== VECTOR_ILLUSTRATION_NAME) return false
          if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })
          return true
        },
      openVectorWorkspace:
        (pos) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(vectorWorkspaceKey, { open: pos })
          return true
        },
      closeVectorWorkspace:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(vectorWorkspaceKey, { close: true })
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: vectorWorkspaceKey,
        state: {
          init: () => ({ editingPos: null }),
          apply: (tr, prev) => {
            const meta = tr.getMeta(vectorWorkspaceKey)
            if (meta?.close) return { editingPos: null }
            if (meta && typeof meta.open === 'number') return { editingPos: meta.open }
            if (prev.editingPos == null || !tr.docChanged) return prev
            // Follow the node through edits elsewhere; close if it was deleted.
            const mapped = tr.mapping.mapResult(prev.editingPos)
            const node = mapped.deleted ? null : tr.doc.nodeAt(mapped.pos)
            return { editingPos: node?.type.name === VECTOR_ILLUSTRATION_NAME ? mapped.pos : null }
          },
        },
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(VectorIllustrationView, {
      // Everything that happens inside the workspace is the canvas's business: keys must
      // not reach ProseMirror's keymap, clicks must not re-select or drag the node.
      stopEvent: ({ event }) => Boolean(event.target?.closest?.(`.${WORKSPACE_CLASS}`)),
      ignoreMutation: () => true,
    })
  },
})

export default VectorIllustration
