// Purpose: verify pure checklist view projection over one coherent immutable snapshot.
// Responsibilities: cover every standard view filter, deterministic ordering, archived
//   exclusion, shared-fact agreement across views, default destinations and saved-view restore.
// Rationale: views are queries over one snapshot; projection must be pure, deterministic
//   and identical for the same item no matter which view renders it.
// Fixtures: .wai/projects/listar/plans/2026-11-02-jams-8be2-views-membership-fixture-design.org
import test from 'node:test';
import assert from 'node:assert/strict';
import { project, defaultDestination, resolveSavedView, STANDARD_VIEWS } from '../views.mjs';

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

// A08 fixture: one frozen snapshot; every view must agree on shared item facts.
const snapshot = deepFreeze({
  revision: 7,
  collections: [{ id: 'c-compras', name: 'Compras', emoji: '🛒', order: 1 }],
  items: [
    { id: 'i-pan', label: 'Pan', text: 'pan', done: false, order: 3, createdAt: 30 },
    { id: 'i-leche', label: 'Leche', text: 'leche', quantity: 2, unit: 'litros', done: false, order: 1, createdAt: 20, collectionId: 'c-compras' },
    { id: 'i-arroz', label: 'Arroz', text: 'arroz', done: true, order: 2, createdAt: 10, collectionId: 'c-compras' },
    { id: 'i-yogur', label: 'Yogur', text: 'yogur', done: true, order: 4, createdAt: 40 },
    { id: 'i-viejo', label: 'Viejo', text: 'viejo', done: false, archived: true, order: 0, createdAt: 5, collectionId: 'c-compras' },
    { id: 'i-tie-b', label: 'TieB', text: 'tieb', done: false, order: 9, createdAt: 50 },
    { id: 'i-tie-a', label: 'TieA', text: 'tiea', done: false, order: 9, createdAt: 40 },
  ],
});

const ids = (rows) => rows.map((row) => row.id);

test('A08: standard views filter the same frozen snapshot with deterministic order', () => {
  assert.deepEqual(ids(project(snapshot, 'pendientes')), ['i-leche', 'i-pan', 'i-tie-a', 'i-tie-b']);
  assert.deepEqual(ids(project(snapshot, 'todo')), ['i-leche', 'i-arroz', 'i-pan', 'i-yogur', 'i-tie-a', 'i-tie-b']);
  assert.deepEqual(ids(project(snapshot, 'completados')), ['i-arroz', 'i-yogur']);
  assert.deepEqual(ids(project(snapshot, 'sin-lista')), ['i-pan', 'i-yogur', 'i-tie-a', 'i-tie-b']);
  assert.deepEqual(ids(project(snapshot, 'collection:c-compras')), ['i-leche', 'i-arroz']);
});

test('archived items are excluded from every standard view', () => {
  for (const view of ['pendientes', 'todo', 'completados', 'sin-lista', 'collection:c-compras']) {
    assert.equal(project(snapshot, view).some((row) => row.archived), false, `${view} leaked an archived item`);
  }
});

test('order ties break by createdAt then ID', () => {
  const rows = project(snapshot, 'todo');
  const tieA = rows.find((row) => row.id === 'i-tie-a');
  const tieB = rows.find((row) => row.id === 'i-tie-b');
  assert.ok(rows.indexOf(tieA) < rows.indexOf(tieB));
});

test('views over the same snapshot agree on shared item facts', () => {
  const milkInTodo = project(snapshot, 'todo').find((row) => row.id === 'i-leche');
  const milkInCollection = project(snapshot, 'collection:c-compras').find((row) => row.id === 'i-leche');
  const milkInPendientes = project(snapshot, 'pendientes').find((row) => row.id === 'i-leche');
  assert.deepEqual(milkInCollection, milkInTodo);
  assert.deepEqual(milkInPendientes, milkInTodo);
  assert.equal(milkInTodo.quantity, 2);
  assert.equal(milkInTodo.unit, 'litros');
});

test('projection does not mutate or unfreeze its inputs', () => {
  const before = structuredClone(snapshot);
  project(snapshot, 'todo');
  assert.deepEqual(snapshot, before);
  assert.ok(Object.isFrozen(snapshot.items[0]));
});

test('default destinations are pending; collection shortcuts default to their collection', () => {
  assert.deepEqual(defaultDestination('pendientes'), { done: false, collectionId: null });
  assert.deepEqual(defaultDestination('completados'), { done: false, collectionId: null });
  assert.deepEqual(defaultDestination('sin-lista'), { done: false, collectionId: null });
  assert.deepEqual(defaultDestination('collection:c-compras'), { done: false, collectionId: 'c-compras' });
});

test('first launch and invalid saved views fall back to pendientes', () => {
  assert.equal(resolveSavedView(null, snapshot), 'pendientes');
  assert.equal(resolveSavedView('gone-view', snapshot), 'pendientes');
  assert.equal(resolveSavedView('completados', snapshot), 'completados');
  assert.equal(resolveSavedView('collection:c-compras', snapshot), 'collection:c-compras');
  assert.equal(resolveSavedView('collection:missing', snapshot), 'pendientes');
  assert.deepEqual(STANDARD_VIEWS.map((view) => view.id), ['pendientes', 'todo', 'completados', 'sin-lista']);
});
