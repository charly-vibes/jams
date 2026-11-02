// Purpose: pin the visible-view text export contract (jams-8be.10, spec A08 + Export row).
// Responsibilities: frozen-snapshot fixtures asserting exact export text per built-in view,
//   scope naming, empty views, and the zero source/diagnostic-data guarantee.
// Rationale: the export must be exactly what the user sees; deriving rows from project()
//   makes that guarantee structural, and deep-frozen inputs prove the exporter never
//   mutates the snapshot it projects.

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatViewExport, viewScopeLabel } from '../view-export.mjs';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

// One shared fixture world: leche (Compras, qty, source/attribute bait),
// pan (sin lista), arroz (Compras, done), yogur (Compras, archived), café (sin lista, done).
function fixtureSnapshot() {
  return freeze({
    revision: 7,
    collections: [{ id: 'c1', name: 'Compras', emoji: '🛒' }],
    items: [
      {
        id: 'i1', label: 'leche', quantity: 2, unit: 'litros', done: false,
        collectionId: 'c1', order: 1, createdAt: 100,
        text: 'comprar leche fresca', sourceAudioId: 'audio-bait',
        attributes: { marca: [{ value: { name: 'La Serenísima' } }] },
      },
      { id: 'i2', label: 'pan', done: false, collectionId: null, order: 2, createdAt: 200 },
      { id: 'i3', label: 'arroz', quantity: 1, unit: 'kg', done: true, collectionId: 'c1', order: 3, createdAt: 300 },
      { id: 'i4', label: 'yogur', done: false, archived: true, collectionId: 'c1', order: 4, createdAt: 400 },
      { id: 'i5', label: 'café', done: true, collectionId: null, order: 5, createdAt: 500 },
    ],
  });
}

test('fixture A08/export pendientes: exporta exactamente las filas visibles con cantidades y estado', () => {
  assert.equal(formatViewExport('pendientes', fixtureSnapshot()),
    'Pendientes · 2 artículos\n☐ leche ×2 litros\n☐ pan');
});

test('fixture A08/export todo: incluye todos los no archivados, con el hecho marcado', () => {
  assert.equal(formatViewExport('todo', fixtureSnapshot()),
    'Todo · 4 artículos\n☐ leche ×2 litros\n☐ pan\n✓ arroz ×1 kg\n✓ café');
});

test('fixture A08/export completados: solo hechos, yogur archivado ausente', () => {
  assert.equal(formatViewExport('completados', fixtureSnapshot()),
    'Completados · 2 artículos\n✓ arroz ×1 kg\n✓ café');
});

test('fixture A08/export sin-lista: sin membresía e incluye completados con su estado', () => {
  assert.equal(formatViewExport('sin-lista', fixtureSnapshot()),
    'Sin lista · 2 artículos\n☐ pan\n✓ café');
});

test('fixture A08/export archivados: solo artículos archivados', () => {
  assert.equal(formatViewExport('archivados', fixtureSnapshot()),
    'Archivados · 1 artículo\n☐ yogur');
});

test('fixture A08/export collection shortcut: usa el nombre de la colección como alcance', () => {
  assert.equal(formatViewExport('collection:c1', fixtureSnapshot()),
    'Compras · 2 artículos\n☐ leche ×2 litros\n✓ arroz ×1 kg');
  assert.equal(viewScopeLabel('collection:c1', fixtureSnapshot()), 'Compras');
});

test('fixture export vista vacía: header con 0 artículos y ninguna fila', () => {
  const snapshot = freeze({ revision: 1, collections: [], items: [] });
  assert.equal(formatViewExport('pendientes', snapshot), 'Pendientes · 0 artículos');
  assert.equal(formatViewExport('completados', fixtureSnapshot()).includes('yogur'), false);
});

test('fixture export privacidad: cero registros de origen, audio, atributos o diagnóstico', () => {
  const text = formatViewExport('todo', fixtureSnapshot());
  for (const forbidden of ['comprar leche fresca', 'audio-bait', 'Serenísima', 'marca', 'diagnóstico', 'origen']) {
    assert.equal(text.includes(forbidden), false, `export must not contain ${forbidden}`);
  }
});

test('fixture export inmutable: la entrada congelada no se muta y admite re-proyección', () => {
  const snapshot = fixtureSnapshot();
  const first = formatViewExport('pendientes', snapshot);
  const second = formatViewExport('pendientes', snapshot);
  assert.equal(first, second);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.items[0]));
});

test('viewScopeLabel resuelve vistas estándar y cae con elegancia en colecciones desconocidas', () => {
  const snapshot = fixtureSnapshot();
  assert.equal(viewScopeLabel('pendientes', snapshot), 'Pendientes');
  assert.equal(viewScopeLabel('sin-lista', snapshot), 'Sin lista');
  assert.equal(viewScopeLabel('collection:missing', snapshot), 'Colección');
  assert.equal(viewScopeLabel('nonsense', snapshot), 'Vista');
});
