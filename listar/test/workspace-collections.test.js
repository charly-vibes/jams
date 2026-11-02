// Purpose: verify collection management never deletes items and always commits atomically.
// Responsibilities: cover creation, rename, shortcut-vs-collection removal semantics,
//   populated-collection detachment, and zero-partial-write aborts for collections.
// Rationale: A10 requires removal to unassign items in one transaction, shortcuts to be
//   view definitions only, and every commit to stay under the workspace revision guard.
// Fixtures: .wai/projects/listar/plans/2026-11-02-jams-8be9-collections-design.org
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { List, Item, Audio } from '../db.js';
import {
  captureItem, createCollection, readWorkspace, removeCollection, renameCollection,
} from '../workspace.mjs';
import { project, removeSavedView } from '../views.mjs';

async function resetDb(name) {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Database ${name} is still open during test reset.`));
  });
}

beforeEach(async () => {
  await resetDb('listar-workspace');
  await resetDb('listar');
});

test('A09 createCollection requires only a name, stores one workspace collection, and bumps the revision', async () => {
  const collection = await createCollection({ name: 'Compras' }, 0);
  assert.equal(collection.name, 'Compras');
  assert.equal(collection.emoji, '');
  assert.equal(typeof collection.id, 'string');
  let snapshot = await readWorkspace();
  assert.deepEqual(snapshot.collections, [{ ...collection }]);
  assert.equal(snapshot.revision, 1);
  const withEmoji = await createCollection({ name: 'Tareas', emoji: '✅' }, 1);
  assert.equal(withEmoji.emoji, '✅');
  snapshot = await readWorkspace();
  assert.equal(snapshot.revision, 2);
  // The new collection is immediately usable as a capture destination.
  await captureItem('pan', 'item-pan', 2, { collectionId: collection.id });
  snapshot = await readWorkspace();
  assert.deepEqual(project(snapshot, `collection:${collection.id}`).map((item) => item.label), ['pan']);
  assert.equal(project(snapshot, `collection:${withEmoji.id}`).length, 0);
});

test('A09 createCollection rejects a blank name and a stale revision with zero writes', async () => {
  await assert.rejects(createCollection({ name: '   ' }, 0), TypeError);
  await createCollection({ name: 'Compras' });
  await assert.rejects(createCollection({ name: 'Otra' }, 99));
  const snapshot = await readWorkspace();
  assert.equal(snapshot.collections.length, 1);
  assert.equal(snapshot.collections[0].name, 'Compras');
  assert.equal(snapshot.revision, 1);
});

test('A09 renameCollection keeps the same id for workspace and legacy collections', async () => {
  const workspaceCollection = await createCollection({ name: 'Compras', emoji: '🛒' });
  const renamed = await renameCollection(workspaceCollection.id, { name: 'Mercado' }, 1);
  assert.equal(renamed.id, workspaceCollection.id);
  assert.equal(renamed.name, 'Mercado');
  assert.equal(renamed.emoji, '🛒');
  assert.equal((await readWorkspace()).revision, 2);

  const legacy = await List.add({ name: 'Trabajo', emoji: '💼' });
  await Item.add({ listId: legacy.id, label: 'informe' });
  const renamedLegacy = await renameCollection(legacy.id, { name: 'Oficina' });
  assert.equal(renamedLegacy.id, legacy.id);
  assert.equal(renamedLegacy.name, 'Oficina');
  const snapshot = await readWorkspace();
  assert.equal(snapshot.collections.find((c) => c.id === legacy.id)?.name, 'Oficina');
  // Membership survives a rename: the item still belongs to the same collection id.
  assert.equal(snapshot.items.find((item) => item.label === 'informe')?.collectionId, legacy.id);
  await assert.rejects(renameCollection(workspaceCollection.id, { name: '  ' }), TypeError);
  assert.equal((await readWorkspace()).collections.find((c) => c.id === workspaceCollection.id)?.name, 'Mercado');
  // A no-op rename is a zero-write no-op: same record, no revision bump.
  // (The legacy rename above already bumped the workspace revision to 3.)
  const untouched = await renameCollection(workspaceCollection.id, { name: 'Mercado' }, 3);
  assert.equal(untouched.name, 'Mercado');
  assert.equal((await readWorkspace()).revision, 3);
});

test('A10 removing a saved shortcut deletes no collection or item and leaves the selector intact', async () => {
  const collection = await createCollection({ name: 'Compras' });
  await captureItem('pan', 'item-1', 1, { collectionId: collection.id });
  const before = await readWorkspace();
  const savedViews = [`collection:${collection.id}`, 'pendientes'];
  const remaining = removeSavedView(savedViews, `collection:${collection.id}`);
  assert.deepEqual(remaining, ['pendientes']);
  const after = await readWorkspace();
  assert.deepEqual(after, before);
  // The collection remains available through the selector options.
  assert.ok(after.collections.some((c) => c.id === collection.id));
  assert.equal(after.items.length, 1);
});

test('A10 removeCollection unassigns a populated collection in one transaction, preserving item identity', async () => {
  const collection = await createCollection({ name: 'Compras', emoji: '🛒' });
  const pan = await captureItem('pan', 'item-pan', 1, { collectionId: collection.id });
  const leche = await captureItem('leche', 'item-leche', 2, { collectionId: collection.id });
  const snapshot = await readWorkspace();
  assert.equal(snapshot.revision, 3);

  const beforeItems = new Map(snapshot.items.map((item) => [item.id, item]));
  await removeCollection(collection.id, 3);
  const after = await readWorkspace();
  assert.equal(after.collections.length, 0);
  assert.equal(after.revision, 4);
  assert.equal(after.items.length, 2);
  for (const item of after.items) {
    const original = beforeItems.get(item.id);
    assert.equal(item.id, original.id);
    assert.equal(item.collectionId, null);
    assert.equal(item.label, original.label);
    assert.equal(item.done, original.done);
    assert.equal(item.order, original.order);
    assert.equal(item.sourceAudioId, original.sourceAudioId);
    assert.equal(item.text, original.text);
  }
  // Unassigned items are visible in Sin lista with their original identity.
  const sinLista = project(after, 'sin-lista');
  assert.deepEqual(sinLista.map((item) => item.id).sort(), [pan.id, leche.id].sort());
  assert.equal(project(after, `collection:${collection.id}`).length, 0);
});

test('A11 removeCollection on a legacy list keeps items, attributes, and audio, leaving them unassigned', async () => {
  const legacy = await List.add({ name: 'Compras', emoji: '🛒' });
  const observation = {
    id: 'obs-1',
    role: 'observation',
    value: {
      type: 'price', amountMinor: 180000, currency: 'ARS',
      basis: { type: 'volume', unit: 'L', quantity: 1 },
      observedAt: '2026-10-28T12:00:00.000Z',
    },
    evidence: { source: 'merchant', quote: '1800 ARS/L' },
  };
  const pan = await Item.add({
    listId: legacy.id, label: 'leche', text: 'dos litros de leche',
    quantity: 2, unit: 'litros', sourceAudioId: 'audio-9', attributes: { price: [observation] },
  });
  const audio = await Audio.add({ listId: legacy.id, blob: new Blob(['audio']), transcript: 'leche', model: 'tiny' });
  // A workspace item can also be a member of a legacy collection through the adapter.
  await captureItem('arroz', 'item-arroz', 0, { collectionId: legacy.id });

  await removeCollection(legacy.id, 1);
  assert.equal(await List.get(legacy.id), undefined);
  const items = await Item.all();
  assert.deepEqual(items.map((item) => item.id).sort(), [pan.id].sort());
  assert.ok(items.every((item) => !Object.hasOwn(item, 'listId')));
  const detached = items[0];
  assert.equal(detached.quantity, 2);
  assert.equal(detached.unit, 'litros');
  assert.equal(detached.sourceAudioId, 'audio-9');
  assert.deepEqual(detached.attributes, { price: [observation] });

  const audios = await new Promise((resolve, reject) => {
    const request = indexedDB.open('listar');
    request.onsuccess = () => {
      const tx = request.result.transaction('audio', 'readonly');
      const getAll = tx.objectStore('audio').getAll();
      getAll.onsuccess = () => { request.result.close(); resolve(getAll.result); };
      getAll.onerror = () => reject(getAll.error);
    };
    request.onerror = () => reject(request.error);
  });
  assert.equal(audios.length, 1);
  assert.equal(audios[0].id, audio.id);
  assert.ok(!Object.hasOwn(audios[0], 'listId'));

  const snapshot = await readWorkspace();
  assert.equal(snapshot.collections.length, 0);
  assert.deepEqual(snapshot.items.map((item) => item.id).sort(), [pan.id, 'item-arroz'].sort());
  assert.ok(snapshot.items.every((item) => item.collectionId === null));
});

test('A15 stale revision aborts collection removal and rename with zero partial writes', async () => {
  const collection = await createCollection({ name: 'Compras' });
  await captureItem('pan', 'item-pan', 1, { collectionId: collection.id });
  const before = await readWorkspace();

  await assert.rejects(removeCollection(collection.id, 99));
  let after = await readWorkspace();
  assert.deepEqual(after, before);

  await assert.rejects(renameCollection(collection.id, { name: 'Otra' }, 42));
  after = await readWorkspace();
  assert.deepEqual(after, before);
  // A wrong id is also a zero-write rejection.
  await assert.rejects(removeCollection('sin-existir', before.revision));
  assert.deepEqual(await readWorkspace(), before);
});
