// Purpose: provide small, testable accessibility primitives for keyboard editing and focus restoration.
// Responsibilities: map editor keydown events to save/cancel actions and remember the focused
//   control across re-renders so focus can return to its origin.
// Rationale: the checklist re-renders rows after every mutation; without an explicit focus
//   keeper, keyboard and screen-reader users lose their place after saving or cancelling.

export function keyAction(event) {
  if (event?.key === 'Enter') return 'save';
  if (event?.key === 'Escape') return 'cancel';
  return null;
}

export function createFocusKeeper(getDocument) {
  let originId = null;
  return {
    save() {
      const doc = getDocument();
      const active = doc?.activeElement;
      originId = typeof active?.id === 'string' && active.id ? active.id : null;
    },
    restore() {
      if (!originId) return false;
      const target = getDocument()?.getElementById?.(originId);
      originId = null;
      if (!target || typeof target.focus !== 'function') return false;
      target.focus();
      return true;
    },
  };
}
