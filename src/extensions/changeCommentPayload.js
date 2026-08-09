/**
 * Per-change comment thread JSON stored in data-comment on track-change marks.
 * Shared shape with st-app-assetmanager (tenant + lawyer conversation).
 */

export function parseCommentPayload(raw) {
  if (!raw) return null
  const trimmed = String(raw).trim()
  if (!trimmed) return null
  if (!trimmed.startsWith('{')) {
    return {
      entries: [
        {
          id: 'legacy-plain',
          text: trimmed,
          createdAt: new Date().toISOString(),
        },
      ],
    }
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed.entries)) {
      const entries = parsed.entries.filter(
        (entry) => entry && typeof entry.text === 'string' && entry.text.trim(),
      )
      return {
        entries,
        updatedAt: parsed.updatedAt,
        resolved: parsed.resolved,
        resolvedAt: parsed.resolvedAt,
      }
    }
    if (typeof parsed.text === 'string' && parsed.text.trim()) {
      return {
        entries: [
          {
            id: 'legacy-0',
            text: parsed.text,
            createdAt: parsed.updatedAt || new Date().toISOString(),
            updatedAt: parsed.updatedAt,
          },
        ],
        updatedAt: parsed.updatedAt,
        resolved: parsed.resolved,
        resolvedAt: parsed.resolvedAt,
      }
    }
  } catch {
    // Fall through to plain-text legacy format below.
  }
  return {
    entries: [
      {
        id: 'legacy-plain',
        text: trimmed,
        createdAt: new Date().toISOString(),
      },
    ],
  }
}

export function serializeCommentPayload(payload) {
  return JSON.stringify(payload)
}

export function hasActiveCommentThread(payload) {
  return Boolean(payload && payload.entries.length > 0 && !payload.resolved)
}

export function appendCommentEntry(existing, text, author, editingIndex = null) {
  const now = new Date().toISOString()
  const base = existing ?? { entries: [] }
  const nextEntries = [...base.entries]
  if (editingIndex !== null && editingIndex >= 0 && editingIndex < nextEntries.length) {
    nextEntries[editingIndex] = {
      ...nextEntries[editingIndex],
      text,
      updatedAt: now,
    }
  } else {
    nextEntries.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      author,
      createdAt: now,
    })
  }
  return {
    entries: nextEntries,
    updatedAt: now,
    resolved: false,
    resolvedAt: undefined,
  }
}

export function resolveCommentPayload(existing) {
  return {
    entries: existing.entries,
    updatedAt: existing.updatedAt,
    resolved: true,
    resolvedAt: new Date().toISOString(),
  }
}

export function reopenCommentPayload(existing) {
  return {
    entries: existing.entries,
    updatedAt: new Date().toISOString(),
    resolved: false,
    resolvedAt: undefined,
  }
}

/** Normalize display names for ownership checks (case, "(User)" / "(Lawyer)" suffix). */
export function normalizeCommentAuthorName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\((lawyer|user)\)/gi, '')
    .trim()
}

/** True when the signed-in user wrote this comment entry (edit own messages only). */
export function isCommentAuthor(entryAuthor, currentUserName) {
  if (!entryAuthor?.trim() || !currentUserName?.trim()) return false
  return normalizeCommentAuthorName(entryAuthor) === normalizeCommentAuthorName(currentUserName)
}
