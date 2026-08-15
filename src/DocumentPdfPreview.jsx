import { useEffect, useState } from 'react'
import PropTypes from 'prop-types'

/**
 * The document as a REAL PDF, rendered server-side and shown in the browser's
 * own PDF viewer.
 *
 * The point is fidelity: what the author reads is byte-for-byte the file the
 * system distributes, not a browser's rendering of the same HTML. Those two
 * drift — different fonts, different line breaking, different pagination — and
 * they drift silently, so a lawyer signs off on a page-2 break that the
 * delivered document does not have. Pagination, zoom and page navigation come
 * free and are the actual PDF's rather than a simulation of them.
 *
 * HOST FETCHES, PACKAGE RENDERS — the same split as `insertExtras` and
 * `placeholderSuggestion`. This component knows nothing about endpoints, auth
 * or which document it is showing; it takes a thunk that resolves to a Blob and
 * owns the part that is easy to get wrong:
 *
 *   • the object-URL lifecycle. These live until the document unloads, so a
 *     preview re-rendered on every toggle leaks steadily. Revoked on the way
 *     out of every effect run, not just on unmount.
 *   • the cancelled-response race. Toggling twice quickly, or editing while a
 *     render is in flight, must not paint a stale PDF over a newer one.
 *   • the three states — loading, error, ready — which every host otherwise
 *     reimplements slightly differently.
 *
 * `fetchPdf` must be a STABLE reference or wrapped in the host's own memo:
 * it is an effect dependency, and a new function each render re-renders the PDF
 * on every keystroke.
 */
export function DocumentPdfPreview({
  fetchPdf,
  height = 640,
  labels = {},
  toolbar = null,
  className = '',
}) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl = null

    setFailed(false)
    setUrl(null)

    void (async () => {
      try {
        const blob = await fetchPdf()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [fetchPdf])

  return (
    <div className={`legal-pdf-preview ${className}`.trim()}>
      {/* The editor toolbar is hidden in preview, so whatever gets the author
          back has to be repeated here — otherwise "Edit" disappears at the one
          moment it is the only way out. */}
      {toolbar ? <div className="legal-pdf-preview__bar">{toolbar}</div> : null}

      {failed ? (
        <div className="legal-pdf-preview__state" style={{ height }}>
          {labels.error || 'Could not render the PDF'}
        </div>
      ) : url ? (
        <iframe
          title={labels.title || 'Preview'}
          src={url}
          className="legal-pdf-preview__frame"
          style={{ height }}
        />
      ) : (
        <div className="legal-pdf-preview__state" style={{ height }}>
          {labels.loading || 'Rendering…'}
        </div>
      )}
    </div>
  )
}

DocumentPdfPreview.propTypes = {
  /** Resolves to the rendered PDF. Keep the reference stable — it is an effect
   *  dependency, so a new function per render re-renders on every keystroke. */
  fetchPdf: PropTypes.func.isRequired,
  height: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  labels: PropTypes.shape({
    title: PropTypes.string,
    loading: PropTypes.string,
    error: PropTypes.string,
  }),
  /** Repeated controls — at minimum, the way back to editing. */
  toolbar: PropTypes.node,
  className: PropTypes.string,
}

export default DocumentPdfPreview
