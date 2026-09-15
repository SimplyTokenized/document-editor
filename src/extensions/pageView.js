import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * On-screen pagination, the way Word's page view works.
 *
 * TipTap lays the document out as one continuous column. The old page guides painted a
 * repeating band over that column at printable-page intervals — but a paragraph sitting on
 * the boundary was simply drawn through the band, the band started one top margin too
 * early (the gradient began at the paper's padding edge), and every page after the first
 * drifted by the band's own height plus the two margins it never accounted for.
 *
 * This measures every top-level block after layout and, wherever a block would run past
 * the bottom of the page it starts on, inserts a widget in front of it: the rest of that
 * page, the bottom margin, a separator strip, and the next page's top margin. The block
 * then starts at the top of the next page, and the separator marks where the printed
 * page really ends. A block explicitly marked "start a new page here" (the PageBreak
 * attribute) is pushed the same way, and a heading is kept with the block after it. A block
 * taller than a whole page — a long table — cannot be pushed and straddles the boundary,
 * as it would be split in Word.
 *
 * Widgets are decorations, so nothing reaches the stored HTML. Positions are measured
 * in the paper's own pre-zoom pixels, so the zoom control leaves the breaks alone.
 */
const pageViewKey = new PluginKey('pageView')

// 1440 twips per inch, 96 CSS px per inch — the same scale buildLayoutVars sizes the paper by.
const TWIPS_PER_PX = 15
const SEPARATOR_PX = 24
const GAP_CLASS = 'legal-page-gap'
// How many times a measurement may re-run on its own result. Inserting a gap between two
// blocks un-collapses their margins, which can nudge everything below by a few pixels;
// measuring again with the gaps in place settles that. Two passes is always enough.
const MAX_SETTLE_PASSES = 3

const A4 = { size: { width: 11906, height: 16838 }, margins: { top: 1134, right: 1134, bottom: 1134, left: 1134 } }

/** The printable height of one page in nominal (pre-zoom) px, from a twips page setup. */
export const printableHeightPx = (pageSetup) => {
  const size = { ...A4.size, ...(pageSetup?.size || {}) }
  const margins = { ...A4.margins, ...(pageSetup?.margins || {}) }
  return Math.max(50, (size.height - margins.top - margins.bottom) / TWIPS_PER_PX)
}

/**
 * Where the gaps go: [{ pos, height, sepTop, page }], one per pushed block, from the
 * current DOM. Existing gaps are subtracted out so the result describes the layout as if
 * none were there, and the algorithm re-inserts them in rendered coordinates.
 *
 * The page grid is the real printable height; the gap between two pages is the paper's
 * actual on-screen padding (which is the margin on a wide screen, and a smaller inset on a
 * phone) plus the separator, so the sheet edges are drawn where the paper's edges are.
 */
const measureBreaks = (view, pageSetup) => {
  const dom = view.dom
  const domRect = dom.getBoundingClientRect()
  // Bounding rects are in screen px, the paper is zoomed: the ratio to offsetWidth (which
  // reports nominal px) is the effective zoom, whatever ancestor applies it.
  const scale = dom.offsetWidth > 0 ? domRect.width / dom.offsetWidth : 1
  const empty = { breaks: [], pages: 1, geo: null }
  if (!(scale > 0)) return empty
  const cs = window.getComputedStyle(dom)
  const padTop = parseFloat(cs.paddingTop) || 0
  const padBottom = parseFloat(cs.paddingBottom) || 0
  const pageHeight = printableHeightPx(pageSetup)
  const gapHeight = padBottom + SEPARATOR_PX + padTop
  const geo = { pageHeight, padTop, padBottom, gapHeight }
  const period = pageHeight + gapHeight

  // Every top-level block, measured as if no gap were in the DOM.
  const blocks = []
  let gapsAbove = 0
  view.state.doc.forEach((node, offset) => {
    const el = view.nodeDOM(offset)
    if (!(el instanceof HTMLElement)) return
    const prev = el.previousElementSibling
    // Fractional, not offsetHeight: gaps have fractional heights, and 40 pages of rounding
    // would walk the grid several pixels off.
    if (prev && prev.classList.contains(GAP_CLASS)) gapsAbove += prev.getBoundingClientRect().height / scale
    const rect = el.getBoundingClientRect()
    blocks.push({
      node,
      pos: offset,
      naturalTop: (rect.top - domRect.top) / scale - padTop - gapsAbove,
      height: rect.height / scale,
      marginTop: parseFloat(window.getComputedStyle(el).marginTop) || 0,
      top: 0,
    })
  })

  const breaks = []
  let shift = 0 // heights of the gaps this pass has decided on so far
  let lastBottom = 0
  // Half a pixel of slack: a block placed exactly on a page top can measure a hair short.
  const pageOf = (top) => Math.floor((top + 0.5) / period)

  // Push block `i` (and the headings glued to it) to the top of the next page.
  const pushToNextPage = (i) => {
    const page = pageOf(blocks[i].top)
    const pageStart = page * period
    // A heading stays with what follows it (Word's keep-with-next): pull the run of headings
    // directly above the block along, unless one of them already opens the page.
    let first = i
    while (
      first > 0 &&
      blocks[first - 1].node.type.name === 'heading' &&
      blocks[first - 1].top - pageStart >= 1 &&
      pageOf(blocks[first - 1].top) === page
    ) {
      first -= 1
    }
    const lead = blocks[first]
    // The gap sits before the block's own top margin, so the gap is the whole distance to
    // the next page and the margin then runs from the page's top edge, as on paper.
    const gapHeight = Math.max(0, pageStart + period - lead.top)
    if (gapHeight < 1) return
    const gapStart = lead.top - lead.marginTop
    // The separator sits after the bottom margin of the page being left. A block that
    // landed inside the gutter (behind a straddling table) gets it at the top instead.
    const sepTop = Math.max(0, pageStart + pageHeight + padBottom - gapStart)
    breaks.push({ pos: lead.pos, height: gapHeight, sepTop, page: page + 2 })
    shift += gapHeight
    for (let j = first; j <= i; j += 1) blocks[j].top = blocks[j].naturalTop + shift
  }

  blocks.forEach((block, i) => {
    block.top = block.naturalTop + shift
    const page = pageOf(block.top)
    const pageStart = page * period
    const pageEnd = pageStart + pageHeight
    const startsPage = block.top - pageStart < 1
    const overflows = block.top + block.height > pageEnd + 0.5
    const fits = block.height <= pageHeight
    const forced = Boolean(block.node.attrs?.pageBreakBefore)
    if (!startsPage && (forced || (overflows && fits))) pushToNextPage(i)
    lastBottom = Math.max(lastBottom, block.top + block.height)
  })

  const pages = Math.max(1, Math.floor(Math.max(0, lastBottom - 1) / period) + 1)
  return { breaks, pages, geo }
}

const sameBreaks = (a, b) =>
  a.length === b.length &&
  a.every(
    (x, i) =>
      x.pos === b[i].pos &&
      Math.round(x.height) === Math.round(b[i].height) &&
      Math.round(x.sepTop) === Math.round(b[i].sepTop),
  )

const buildDecorations = (doc, breaks) =>
  DecorationSet.create(
    doc,
    breaks.map(({ pos, height, sepTop, page }) =>
      Decoration.widget(
        pos,
        () => {
          const gap = document.createElement('div')
          gap.className = GAP_CLASS
          gap.style.height = `${height}px`
          gap.style.setProperty('--legal-gap-sep-top', `${sepTop}px`)
          const sep = document.createElement('div')
          sep.className = `${GAP_CLASS}__sep`
          sep.setAttribute('data-page', String(page))
          gap.appendChild(sep)
          return gap
        },
        { side: -1, key: `${GAP_CLASS}:${pos}:${Math.round(height)}:${Math.round(sepTop)}` },
      ),
    ),
  )

export const PageView = Extension.create({
  name: 'pageView',

  addOptions() {
    return {
      /** Off until the host turns it on with `setPageView`. */
      enabled: false,
      /** Page size + margins in twips (the editor's pageSetup); A4 / 2 cm when null. */
      pageSetup: null,
    }
  },

  addCommands() {
    return {
      /**
       * Turn the page view on or off and/or hand it a new page setup.
       * @param {{ enabled?: boolean, pageSetup?: object | null }} config
       */
      setPageView:
        (config) =>
        ({ tr }) => {
          tr.setMeta(pageViewKey, { config })
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const extension = this
    return [
      new Plugin({
        key: pageViewKey,
        state: {
          init: () => ({
            enabled: extension.options.enabled,
            pageSetup: extension.options.pageSetup,
            breaks: [],
            decorations: DecorationSet.empty,
            configVersion: 0,
          }),
          apply: (tr, prev) => {
            const meta = tr.getMeta(pageViewKey)
            if (meta?.config) {
              const next = { ...prev, ...meta.config, configVersion: prev.configVersion + 1 }
              if (!next.enabled) return { ...next, breaks: [], decorations: DecorationSet.empty }
              return next
            }
            if (meta?.breaks) {
              return { ...prev, breaks: meta.breaks, decorations: buildDecorations(tr.doc, meta.breaks) }
            }
            if (tr.docChanged) {
              // Keep the gaps where they were until the next measurement — no flicker.
              return {
                ...prev,
                breaks: prev.breaks.map((b) => ({ ...b, pos: tr.mapping.map(b.pos) })),
                decorations: prev.decorations.map(tr.mapping, tr.doc),
              }
            }
            return prev
          },
        },
        props: {
          decorations(state) {
            return pageViewKey.getState(state)?.decorations
          },
        },
        view(view) {
          let raf = 0
          let passes = 0

          const applyMinHeight = (geo, pages) => {
            // The last page is a full sheet too — the paper is padded out to its bottom edge.
            view.dom.style.minHeight = `${pages * geo.pageHeight + (pages - 1) * geo.gapHeight + geo.padTop + geo.padBottom}px`
          }

          const measure = () => {
            raf = 0
            if (view.isDestroyed) return
            const state = pageViewKey.getState(view.state)
            if (!state?.enabled) {
              view.dom.style.minHeight = ''
              return
            }
            const { breaks, pages, geo } = measureBreaks(view, state.pageSetup)
            if (geo) applyMinHeight(geo, pages)
            if (sameBreaks(breaks, state.breaks)) return
            view.dispatch(view.state.tr.setMeta(pageViewKey, { breaks }).setMeta('addToHistory', false))
            // Measure once more with the new gaps in place (see MAX_SETTLE_PASSES).
            if (passes < MAX_SETTLE_PASSES) {
              passes += 1
              schedule(false)
            }
          }
          const schedule = (fresh = true) => {
            if (fresh) passes = 0
            if (!raf) raf = requestAnimationFrame(measure)
          }

          // Re-flow on a width change (the paper narrowing wraps text differently) and on
          // late-arriving fonts, both of which move every block.
          const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null
          observer?.observe(view.dom)
          schedule()

          return {
            update(v, prevState) {
              const next = pageViewKey.getState(v.state)
              const prev = pageViewKey.getState(prevState)
              if (v.state.doc !== prevState.doc || next?.configVersion !== prev?.configVersion) schedule()
            },
            destroy() {
              observer?.disconnect()
              if (raf) cancelAnimationFrame(raf)
            },
          }
        },
      }),
    ]
  },
})

export default PageView
