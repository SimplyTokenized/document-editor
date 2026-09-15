/**
 * Pictures on their way into a document: downscaled and re-encoded in the browser before
 * they are stored or uploaded, so a 12-megapixel phone photo does not become a 6 MB
 * document. Photos re-encode as JPEG; anything with transparency stays PNG.
 */
const MAX_EDGE = 1600
const JPEG_QUALITY = 0.85

const isImageFile = (file) => Boolean(file && /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i.test(file.type))

/** Image files among a paste / drop payload, in order. */
export const imageFilesOf = (dataTransfer) => {
  const out = []
  const files = dataTransfer?.files ? Array.from(dataTransfer.files) : []
  files.forEach((file) => {
    if (isImageFile(file)) out.push(file)
  })
  if (!out.length && dataTransfer?.items) {
    Array.from(dataTransfer.items).forEach((item) => {
      const file = item.kind === 'file' ? item.getAsFile() : null
      if (isImageFile(file)) out.push(file)
    })
  }
  return out
}

const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('The file is not an image the browser can open.'))
    }
    image.src = url
  })

/** Does the picture use transparency anywhere? (Sampled — enough to pick PNG over JPEG.) */
const hasAlpha = (ctx, width, height) => {
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4096)))
  const { data } = ctx.getImageData(0, 0, width, height)
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (data[(y * width + x) * 4 + 3] < 250) return true
    }
  }
  return false
}

/**
 * @param {File|Blob} file
 * @param {{ maxEdge?: number, quality?: number }} [options]
 * @returns {Promise<{ blob: Blob, dataUrl: string, width: number, height: number, type: string }>}
 */
export const prepareImageFile = async (file, { maxEdge = MAX_EDGE, quality = JPEG_QUALITY } = {}) => {
  // A vector file is kept as it is — rasterising it would throw away the very thing it is.
  if (/svg/i.test(file.type)) {
    const text = await file.text()
    const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`
    return { blob: file, dataUrl, width: null, height: null, type: file.type }
  }
  const image = await loadImage(file)
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0, width, height)
  const keepPng = /png|gif|webp/i.test(file.type) && hasAlpha(ctx, width, height)
  const type = keepPng ? 'image/png' : 'image/jpeg'
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The image could not be encoded.'))), type, quality),
  )
  const dataUrl = canvas.toDataURL(type, quality)
  return { blob, dataUrl, width, height, type }
}

/**
 * Insert picture files at the selection: prepared, then stored by the host's `uploadImage`
 * (a URL) or, without one or if it fails, embedded inline as a data URI.
 * @param {import('@tiptap/core').Editor} editor
 * @param {File[]} files
 * @param {(blob: Blob, meta: { width: number|null, height: number|null, name: string, type: string }) => Promise<{ url: string, width?: number, height?: number }>} [uploadImage]
 */
export const insertImageFiles = async (editor, files, uploadImage) => {
  for (const file of files) {
    let prepared
    try {
      prepared = await prepareImageFile(file)
    } catch (err) {
      console.warn('[document-editor] image skipped:', err)
      continue
    }
    let src = prepared.dataUrl
    let { width, height } = prepared
    if (typeof uploadImage === 'function') {
      try {
        const stored = await uploadImage(prepared.blob, {
          width,
          height,
          name: file.name || 'image',
          type: prepared.type,
        })
        if (stored?.url) {
          src = stored.url
          width = stored.width || width
          height = stored.height || height
        }
      } catch (err) {
        console.warn('[document-editor] upload failed, image embedded inline instead:', err)
      }
    }
    if (editor.isDestroyed) return
    editor
      .chain()
      .focus()
      .setImage({ src, ...(width ? { width } : {}), ...(height ? { height } : {}) })
      .run()
  }
}

/** Open the browser's file picker for pictures; resolves with the chosen files. */
export const pickImageFiles = () =>
  new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml'
    input.multiple = true
    input.style.display = 'none'
    input.onchange = () => {
      resolve(Array.from(input.files || []))
      input.remove()
    }
    document.body.appendChild(input)
    input.click()
  })
