// Purpose: pure checklist view projection over one coherent workspace snapshot.
// Responsibilities: filter and sort rows for the standard views and collection
//   shortcuts, expose creation defaults, and resolve the last valid saved view.
// Rationale: views are queries, not storage; projection must be deterministic,
//   mutation-free, and identical for the same item in every view over one snapshot.

export const STANDARD_VIEWS = Object.freeze([
  Object.freeze({ id: 'pendientes', label: 'Pendientes' }),
  Object.freeze({ id: 'todo', label: 'Todo' }),
  Object.freeze({ id: 'completados', label: 'Completados' }),
  Object.freeze({ id: 'sin-lista', label: 'Sin lista' }),
]);

const DEFAULT_VIEW = 'pendientes';

function viewPredicate(view) {
  if (view === 'pendientes') return (item) => item.done === false;
  if (view === 'todo') return () => true;
  if (view === 'completados') return (item) => item.done === true;
  if (view === 'sin-lista') return (item) => item.collectionId == null;
  if (view.startsWith('collection:')) {
    const collectionId = view.slice('collection:'.length);
    return (item) => item.collectionId === collectionId;
  }
  throw new TypeError(`Unknown view: ${view}`);
}

function byDeterministicOrder(a, b) {
  const createdA = Number(a.createdAt);
  const createdB = Number(b.createdAt);
  const byCreated = Number.isFinite(createdA) && Number.isFinite(createdB)
    ? createdA - createdB
    : String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
  return (a.order ?? 0) - (b.order ?? 0)
    || byCreated
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function project(snapshot, view) {
  if (!snapshot || !Array.isArray(snapshot.items)) throw new TypeError('project needs a snapshot with items.');
  const predicate = viewPredicate(view);
  return snapshot.items
    .filter((item) => item.archived !== true)
    .filter(predicate)
    .map((item) => (item.attributes ? { ...item, attributes: structuredClone(item.attributes) } : item))
    .sort(byDeterministicOrder);
}

export function defaultDestination(view) {
  return { done: false, collectionId: view.startsWith('collection:') ? view.slice('collection:'.length) : null };
}

export function resolveSavedView(savedId, snapshot) {
  if (typeof savedId !== 'string' || !savedId) return DEFAULT_VIEW;
  if (STANDARD_VIEWS.some((view) => view.id === savedId)) return savedId;
  if (savedId.startsWith('collection:') && snapshot?.collections?.some((c) => c.id === savedId.slice('collection:'.length))) {
    return savedId;
  }
  return DEFAULT_VIEW;
}
