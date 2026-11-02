// Purpose: provide pure undo planning over action receipts.
// Responsibilities: map a before/after receipt to a field-level inverse against the
//   current item, enforcing preconditions and A13 stale reconfirmation.
// Rationale: undo must construct a new guarded action on current data, reverting only
//   what the original action touched — never restoring an old snapshot.

function relevantFields(action) {
  return {
    label: ['label'],
    quantity: ['quantity', 'unit'],
    completion: ['done'],
    archive: ['archived'],
    restore: ['archived'],
    membership: ['collectionId'],
  }[action] ?? [];
}

function relevantEqual(action, after, current) {
  if (action === 'capture') {
    // Snapshot items carry the joined collectionId; the capture receipt does not.
    const strip = ({ collectionId: _omit, ...rest }) => rest;
    return JSON.stringify(strip(after ?? {})) === JSON.stringify(strip(current ?? {}));
  }
  return relevantFields(action).every((key) => {
    const a = after?.[key] === undefined ? null : after[key];
    const b = current?.[key] === undefined ? null : current[key];
    return a === b;
  });
}

function inverseFields(action, before) {
  if (action === 'label') return { label: before.label };
  if (action === 'quantity') return { quantity: before?.quantity ?? null, unit: before?.unit ?? null };
  if (action === 'completion') return { done: before.done === true };
  if (action === 'archive' || action === 'restore') return { archived: before?.archived === true };
  throw new TypeError(`Action without field inverse: ${action}`);
}

export function planUndo(receipt, currentItem, { confirmStale = false } = {}) {
  if (!receipt || typeof receipt !== 'object') throw new TypeError('planUndo needs an action receipt.');
  if (!currentItem) {
    return receipt.action === 'capture'
      ? { ok: false, reason: `El artículo ${receipt.itemId} ya no existe; no se puede deshacer el agregado.` }
      : { ok: false, reason: `El artículo ${receipt.itemId} ya no existe.` };
  }
  if (!relevantEqual(receipt.action, receipt.after, currentItem)) {
    if (receipt.action === 'capture') {
      return { ok: false, reason: `El artículo agregado cambió desde entonces; deshacer el agregado no está disponible.` };
    }
    if (!confirmStale) return { ok: false, stale: true, current: currentItem };
  }
  if (receipt.action === 'capture') return { ok: true, kind: 'remove', itemId: receipt.itemId };
  if (receipt.action === 'membership') {
    return { ok: true, kind: 'membership', collectionId: receipt.before?.collectionId ?? null };
  }
  return { ok: true, kind: 'fields', fields: inverseFields(receipt.action, receipt.before) };
}
