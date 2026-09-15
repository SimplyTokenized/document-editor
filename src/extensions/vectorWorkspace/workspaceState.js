import { PluginKey } from '@tiptap/pm/state'

/** Plugin state of the vector workspace: `{ editingPos }` — the one open illustration. */
export const vectorWorkspaceKey = new PluginKey('vectorWorkspace')

/** Document position of the illustration currently open in the workspace, or null. */
export const getVectorWorkspacePos = (state) => vectorWorkspaceKey.getState(state)?.editingPos ?? null

export const VECTOR_ILLUSTRATION_NAME = 'vectorIllustration'
