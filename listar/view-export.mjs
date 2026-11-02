// Purpose: pure text export of the currently visible checklist view.
// Responsibilities: name the export scope, derive rows through project() so the text
//   matches exactly what the screen shows, and format only label, quantity, unit and
//   completion status as readable Spanish text.
// Rationale: the export contract (spec: Export, A08) demands the visible selection with
//   zero hidden, source or diagnostic records; deriving rows from project() keeps that
//   guarantee structural and testable without DOM or storage, and deep-frozen snapshots
//   prove the exporter never mutates what it projects.

import { project, STANDARD_VIEWS } from './views.mjs';

export function viewScopeLabel(view, snapshot) {
  const standard = STANDARD_VIEWS.find((entry) => entry.id === view);
  if (standard) return standard.label;
  if (typeof view === 'string' && view.startsWith('collection:')) {
    const collectionId = view.slice('collection:'.length);
    return snapshot?.collections?.find((collection) => collection.id === collectionId)?.name ?? 'Colección';
  }
  return 'Vista';
}

function formatRow(item) {
  const status = item.done ? '✓' : '☐';
  const amount = item.quantity == null ? '' : ` ×${item.quantity}${item.unit ? ` ${item.unit}` : ''}`;
  return `${status} ${item.label}${amount}`;
}

export function formatViewExport(view, snapshot) {
  const rows = project(snapshot, view);
  const count = rows.length;
  const header = `${viewScopeLabel(view, snapshot)} · ${count} artículo${count === 1 ? '' : 's'}`;
  return count === 0 ? header : `${header}\n${rows.map(formatRow).join('\n')}`;
}
