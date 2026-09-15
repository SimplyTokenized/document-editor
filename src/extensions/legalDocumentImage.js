import Image from '@tiptap/extension-image'
import { mergeAttributes } from '@tiptap/core'
import { normalizeWrap, parseWrapFromElement, vectorPresentationStyle } from './vectorLayout.js'

function parsePixelDimension(value) {
  if (value == null || value === '') return null
  const parsed = Number.parseInt(String(value).replace(/px$/i, ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Inline styles persisted on <img> so Preview matches the editor (no node view). The same
 * placement model as the vector illustration (vectorLayout.js): alignment for a block of
 * its own, or a float with the text wrapping around it.
 */
export function legalImagePresentationStyle(attrs) {
  const align = attrs.align === 'center' || attrs.align === 'right' ? attrs.align : 'left'
  return vectorPresentationStyle({
    align,
    width: parsePixelDimension(attrs.width),
    height: parsePixelDimension(attrs.height),
    wrap: attrs.wrap,
  })
}

function parseAlignFromElement(element) {
  const dataAlign = element.getAttribute('data-align')
  if (dataAlign === 'center' || dataAlign === 'right' || dataAlign === 'left') {
    return dataAlign
  }

  const style = element.getAttribute('style') ?? ''
  if (style.includes('margin-left:auto') && style.includes('margin-right:auto')) {
    return 'center'
  }
  if (style.includes('margin-left:auto') && style.includes('margin-right:0')) {
    return 'right'
  }

  return 'left'
}

export function applyLegalImageAlign(dom, align, wrap = 'none') {
  const value = align === 'center' || align === 'right' ? align : 'left'
  const mode = normalizeWrap(wrap)

  dom.style.display = 'block'
  dom.style.width = 'fit-content'
  dom.style.maxWidth = '100%'

  if (mode === 'left' || mode === 'right') {
    // The resize wrapper is what floats; the picture inside stays a plain block.
    dom.style.float = mode
    dom.style.margin = mode === 'left' ? '0.25rem 1rem 0.5rem 0' : '0.25rem 0 0.5rem 1rem'
  } else {
    dom.style.float = ''
    dom.style.margin = ''
    if (value === 'center') {
      dom.style.marginLeft = 'auto'
      dom.style.marginRight = 'auto'
    } else if (value === 'right') {
      dom.style.marginLeft = 'auto'
      dom.style.marginRight = '0'
    } else {
      dom.style.marginLeft = '0'
      dom.style.marginRight = 'auto'
    }
  }

  dom.dataset.align = value
  dom.dataset.wrap = mode
}

function syncImagePresentation(img, attrs) {
  // Inside the (floating) wrapper the <img> itself never floats.
  img.style.cssText = legalImagePresentationStyle({ ...attrs, wrap: 'none' })
}

/**
 * Resizable contract images — matches asset manager LegalDocumentImage behaviour.
 */
export const LegalDocumentImage = Image.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      inline: false,
      allowBase64: true,
      HTMLAttributes: { class: 'rich-text-editor__image' },
      resize: {
        enabled: true,
        minWidth: 50,
        minHeight: 50,
        alwaysPreserveAspectRatio: true,
      },
    }
  },

  addAttributes() {
    const parentAttributes = this.parent?.() ?? {}

    return {
      ...parentAttributes,
      width: {
        default: null,
        parseHTML: (element) =>
          parsePixelDimension(element.getAttribute('width')) ??
          parsePixelDimension(element.style.width),
        renderHTML: () => ({}),
      },
      height: {
        default: null,
        parseHTML: (element) =>
          parsePixelDimension(element.getAttribute('height')) ??
          parsePixelDimension(element.style.height),
        renderHTML: () => ({}),
      },
      align: {
        default: 'left',
        parseHTML: (element) => parseAlignFromElement(element),
        renderHTML: () => ({}),
      },
      /** How text treats the picture: 'none' (above/below), 'left' or 'right' (wraps around). */
      wrap: {
        default: 'none',
        parseHTML: (element) => parseWrapFromElement(element),
        renderHTML: () => ({}),
      },
    }
  },

  renderHTML({ HTMLAttributes }) {
    const align = HTMLAttributes.align || 'left'
    const wrap = normalizeWrap(HTMLAttributes.wrap)
    const width = parsePixelDimension(HTMLAttributes.width)
    const height = parsePixelDimension(HTMLAttributes.height)

    const { align: _align, wrap: _wrap, width: _width, height: _height, style: _style, ...rest } = HTMLAttributes

    return [
      'img',
      mergeAttributes(this.options.HTMLAttributes, rest, {
        'data-align': align,
        'data-wrap': wrap,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        style: legalImagePresentationStyle({ align, width, height, wrap }),
      }),
    ]
  },

  addNodeView() {
    const parentFactory = this.parent?.()
    if (!parentFactory) return null

    return (props) => {
      const nodeView = parentFactory(props)
      if (!nodeView || typeof nodeView === 'function') return nodeView

      const dom = nodeView.dom
      const img = dom.querySelector('img')

      applyLegalImageAlign(dom, props.node.attrs.align, props.node.attrs.wrap)

      if (img instanceof HTMLImageElement) {
        syncImagePresentation(img, {
          align: props.node.attrs.align,
          width: props.node.attrs.width,
          height: props.node.attrs.height,
        })

        const reveal = () => {
          dom.style.visibility = ''
          dom.style.pointerEvents = ''
        }

        if (img.complete) {
          reveal()
        } else {
          img.addEventListener('load', reveal, { once: true })
          img.addEventListener('error', reveal, { once: true })
        }
      }

      const originalUpdate = nodeView.update?.bind(nodeView)
      nodeView.update = (updatedNode, decorations, innerDecorations) => {
        const result = originalUpdate
          ? originalUpdate(updatedNode, decorations, innerDecorations)
          : true

        if (result !== false && updatedNode.type.name === this.name) {
          applyLegalImageAlign(dom, updatedNode.attrs.align, updatedNode.attrs.wrap)
          if (img instanceof HTMLImageElement) {
            syncImagePresentation(img, {
              align: updatedNode.attrs.align,
              width: updatedNode.attrs.width,
              height: updatedNode.attrs.height,
            })
          }
        }

        return result ?? true
      }

      return nodeView
    }
  },
})

export function setLegalImageAlign(editor, align) {
  if (!editor.isActive('image')) return false
  return editor.chain().focus().updateAttributes('image', { align }).run()
}

export function getLegalImageAlign(editor) {
  if (!editor.isActive('image')) return null
  const align = editor.getAttributes('image').align
  return align === 'center' || align === 'right' ? align : 'left'
}

// The vector illustration block aligns like an image (its own `align` attribute, not
// TextAlign). Named by string so this module does not import the node — it is imported
// by the node's view for legalImagePresentationStyle.
const VECTOR_NODE = 'vectorIllustration'

export function setLegalContentAlign(editor, align) {
  if (editor.isActive('image')) {
    return setLegalImageAlign(editor, align)
  }
  if (editor.isActive(VECTOR_NODE)) {
    return editor.chain().focus().updateAttributes(VECTOR_NODE, { align }).run()
  }
  return editor.chain().focus().setTextAlign(align).run()
}

export function isLegalContentAlignActive(editor, align) {
  const imageAlign = getLegalImageAlign(editor)
  if (imageAlign) return imageAlign === align
  if (editor.isActive(VECTOR_NODE)) return (editor.getAttributes(VECTOR_NODE).align || 'center') === align
  return editor.isActive({ textAlign: align })
}

/** Serialize editor HTML with image width/height/align from the document model. */
export function serializeLegalDocumentEditorHtml(editor) {
  const html = editor.getHTML()
  if (!html) return ''

  const imageMeta = []

  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'image' || !node.attrs.src) return
    imageMeta.push({
      src: String(node.attrs.src),
      align: node.attrs.align || 'left',
      wrap: normalizeWrap(node.attrs.wrap),
      width: parsePixelDimension(node.attrs.width),
      height: parsePixelDimension(node.attrs.height),
    })
  })

  if (imageMeta.length === 0) return html

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const images = Array.from(doc.querySelectorAll('img'))

  imageMeta.forEach((meta, index) => {
    const img = images.find((element) => element.getAttribute('src') === meta.src) ?? images[index]
    if (!img) return

    img.setAttribute('data-align', meta.align)
    img.setAttribute('data-wrap', meta.wrap)
    if (meta.width) img.setAttribute('width', String(meta.width))
    else img.removeAttribute('width')
    if (meta.height) img.setAttribute('height', String(meta.height))
    else img.removeAttribute('height')
    img.setAttribute(
      'style',
      legalImagePresentationStyle({
        align: meta.align,
        width: meta.width,
        height: meta.height,
      }),
    )
  })

  return doc.body.innerHTML
}

/** Ensures Preview matches editor sizing for saved HTML missing inline styles. */
export function normalizeLegalDocumentImagesInHtml(html) {
  if (!html) return ''

  const doc = new DOMParser().parseFromString(html, 'text/html')

  doc.querySelectorAll('img').forEach((img) => {
    const existingStyle = img.getAttribute('style') ?? ''
    if (existingStyle.includes('width:') && existingStyle.includes('margin-left:')) {
      return
    }

    const align = img.getAttribute('data-align')
    const width = img.getAttribute('width')
    const height = img.getAttribute('height')

    img.setAttribute('style', legalImagePresentationStyle({ align, width, height }))
  })

  return doc.body.innerHTML
}
