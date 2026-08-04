export const EDITOR_SESSION_FORMAT = 'pugc-editor-session';
export const EDITOR_SESSION_VERSION = 1;
export const EDITOR_SESSION_EXTENSION = '.pugcedit';

export function createEditorSession(snapshot, metadata = {}) {
  return {
    format: EDITOR_SESSION_FORMAT,
    version: EDITOR_SESSION_VERSION,
    savedAt: new Date().toISOString(),
    metadata,
    snapshot,
  };
}

export function parseEditorSession(text) {
  const parsed = JSON.parse(text);
  if (parsed?.format !== EDITOR_SESSION_FORMAT) {
    throw new Error('Not a PUGC editor project file');
  }
  if (parsed.version !== EDITOR_SESSION_VERSION) {
    throw new Error(`Unsupported editor project version ${parsed.version}`);
  }
  if (!parsed.snapshot?.pugcJson) {
    throw new Error('Editor project is missing scene data');
  }
  return parsed;
}

export function editorSessionName(sourceName = 'Untitled') {
  const base = String(sourceName || 'Untitled')
    .replace(/\.(pugc|json|pugcedit)$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .trim() || 'Untitled';
  return `${base}${EDITOR_SESSION_EXTENSION}`;
}
