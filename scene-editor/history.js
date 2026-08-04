export function createHistoryController({
  canRecord,
  makeSnapshot,
  restoreSnapshot,
  snapshotKey,
  setStatus,
  limit = 60,
}) {
  const undoStack = [];
  const redoStack = [];
  let transaction = null;
  let applying = false;

  function pushUndoSnapshot(before, label = 'Edit') {
    if (applying || !before) return;
    const after = makeSnapshot();
    if (!after || snapshotKey(before) === snapshotKey(after)) return;
    undoStack.push({ label, state: before });
    if (undoStack.length > limit) undoStack.shift();
    redoStack.length = 0;
  }

  function applySnapshot(snapshot) {
    applying = true;
    try {
      restoreSnapshot(snapshot);
    } finally {
      applying = false;
    }
  }

  return {
    get applying() {
      return applying;
    },

    reset() {
      undoStack.length = 0;
      redoStack.length = 0;
      transaction = null;
    },

    begin(label = 'Edit') {
      if (applying || transaction || !canRecord()) return;
      transaction = { label, before: makeSnapshot() };
    },

    commit(label = transaction?.label || 'Edit') {
      if (!transaction) return;
      const before = transaction.before;
      transaction = null;
      pushUndoSnapshot(before, label);
    },

    cancel() {
      transaction = null;
    },

    undo() {
      this.commit();
      const entry = undoStack.pop();
      if (!entry) {
        setStatus('Nothing to undo');
        return;
      }
      const current = makeSnapshot();
      if (current) redoStack.push({ label: entry.label, state: current });
      if (redoStack.length > limit) redoStack.shift();
      applySnapshot(entry.state);
      setStatus(`Undid ${entry.label}`);
    },

    redo() {
      this.commit();
      const entry = redoStack.pop();
      if (!entry) {
        setStatus('Nothing to redo');
        return;
      }
      const current = makeSnapshot();
      if (current) undoStack.push({ label: entry.label, state: current });
      if (undoStack.length > limit) undoStack.shift();
      applySnapshot(entry.state);
      setStatus(`Redid ${entry.label}`);
    },
  };
}
