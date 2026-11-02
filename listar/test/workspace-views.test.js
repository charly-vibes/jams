// Purpose: verify workspace v2 collections/memberships, the legacy read adapter,
//   destination capture and guarded membership moves.
// Responsibilities: cover v1→v2 upgrade preservation, destination capture, moveItem
//   invariants (exactly one membership write, zero item-field writes), aborts, and
//   legacy-visibility through the adapter without copying or mutating legacy rows.
// Rationale: views need one coherent snapshot over workspace and legacy data; moves
//   must change membership of the same item, never copy or merge it.
// Fixtures: .wai/projects/listar/plans/2026-11-02-jams-8be2-views-membership-fixture-design.org
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { List, Item } from '../db.js';
import { captureItem, moveItem, readWorkspace } from '../workspace.mjs';
import { project } from '../views.mjs';

const workspaceDb = 'listar-workspace';
beforeEach(async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(workspaceDb);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Workspace database is still open during test reset.'));
  });
});

async function seedLegacyListWithItems() {
  const list = await List.add({ name: 'Compras', emoji: '🛒' });
  const milk = await Item.add({ listId: list.id, label: 'Leche', text: 'leche', quantity: 2, unit: 'litros', order: 2 });
  const bread = await Item.add({ listId: list.id, label: 'Pan', text: 'pan', done: true, order: 1 });
  return { list, milk, bread };
}

test('v1 workspaces upgrade to v2 preserving captured items, revision and replay receipts', async () => {
  // Seed a v1-shaped workspace exactly as jams-8be.1 shipped it.
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(workspaceDb, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('meta', { keyPath: 'key' }).put({ key: 'revision', value: 1 });
      db.createObjectStore('items', { keyPath: 'id' }).put({ id: 'cap-1', label: 'pan', text: 'pan', done: false, order: 1 });
      db.createObjectStore('operations', { keyPath: 'id' }).put({ id: 'cap-1', label: 'pan', item: { id: 'cap-1', label: 'pan' } });
    };
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  });

  const snapshot = await readWorkspace();
  assert.equal(snapshot.revision, 1);
  assert.deepEqual(snapshot.items.map((item) => item.id), ['cap-1']);
  assert.deepEqual(snapshot.collections, []);
  const replay = await captureItem('pan', 'cap-1', 1);
  assert.equal(replay.id, 'cap-1');
  assert.equal((await readWorkspace()).revision, 1);
});

test('capture with an explicit destination records exactly one membership', async () => {
  const list = await List.add({ name: 'Compras' });
  const captured = await captureItem('arroz', 'cap-2', 0, { collectionId: list.id });
  assert.equal(Object.hasOwn(captured, 'collectionId'), false);

  const snapshot = await readWorkspace();
  const item = snapshot.items.find((entry) => entry.id === 'cap-2');
  assert.equal(item.collectionId, list.id);
  assert.deepEqual(project(snapshot, 'collection:' + list.id).map((row) => row.id), ['cap-2']);
  assert.deepEqual(project(snapshot, 'sin-lista').map((row) => row.id), []);
  assert.equal(snapshot.revision, 1);
});

test('capture to a missing collection rejects with zero writes', async () => {
  await assert.rejects(captureItem('arroz', 'cap-3', 0, { collectionId: 'gone' }));
  const snapshot = await readWorkspace();
  assert.equal(snapshot.revision, 0);
  assert.equal(snapshot.items.length, 0);
});

test('A09: moveItem changes exactly one membership and zero item fields', async () => {
  const list = await List.add({ name: 'Compras' });
  const pan = await captureItem('pan', 'cap-4', 0);
  const before = structuredClone(await readWorkspace());

  const moved = await moveItem('cap-4', list.id, 1);
  assert.equal(moved.moved, true);
  assert.equal(moved.item.collectionId, list.id);

  const after = await readWorkspace();
  assert.equal(after.revision, 2);
  const itemAfter = after.items.find((entry) => entry.id === 'cap-4');
  const { collectionId: _omit, ...itemRest } = itemAfter;
  const itemBefore = before.items.find((entry) => entry.id === 'cap-4');
  const { collectionId: _omit2, ...itemRestBefore } = itemBefore;
  assert.deepEqual(itemRest, itemRestBefore);
  assert.deepEqual(project(after, 'sin-lista').map((row) => row.id), []);
  assert.deepEqual(project(after, 'collection:' + list.id).map((row) => row.id), ['cap-4']);
});

test('moveItem to the current destination is a no-op and stale revision rejects with zero writes', async () => {
  const list = await List.add({ name: 'Compras' });
  await captureItem('pan', 'cap-5', 0);
  await moveItem('cap-5', list.id, 1);

  const noop = await moveItem('cap-5', list.id, 2);
  assert.equal(noop.moved, false);
  assert.equal((await readWorkspace()).revision, 2);

  await assert.rejects(moveItem('cap-5', null, 99));
  const snapshot = await readWorkspace();
  assert.equal(snapshot.revision, 2);
  assert.equal(snapshot.items.find((entry) => entry.id === 'cap-5').collectionId, list.id);

  const detached = await moveItem('cap-5', null, 2);
  assert.equal(detached.item.collectionId, null);
  assert.deepEqual(project(await readWorkspace(), 'sin-lista').map((row) => row.id), ['cap-5']);
});

test('legacy lists and items appear in the snapshot with IDs preserved and no copying', async () => {
  const { list, milk, bread } = await seedLegacyListWithItems();
  const captured = await captureItem('sal', 'cap-6', 0);

  const snapshot = await readWorkspace();
  const collection = snapshot.collections.find((entry) => entry.id === list.id);
  assert.equal(collection.name, 'Compras');
  assert.deepEqual(project(snapshot, 'collection:' + list.id).map((row) => row.id), [bread.id, milk.id]);
  assert.deepEqual(project(snapshot, 'sin-lista').map((row) => row.id), [captured.id]);

  const legacyMilk = snapshot.items.find((entry) => entry.id === milk.id);
  assert.equal(legacyMilk.collectionId, list.id);
  assert.equal(legacyMilk.quantity, 2);
  assert.equal((await Item.get(milk.id)).listId, list.id);
  assert.equal(snapshot.items.some((entry) => entry.id === captured.id), true);
});

test('moving a legacy item detaches membership via override record without touching the legacy row', async () => {
  const { list, bread } = await seedLegacyListWithItems();
  const snapshotBefore = await readWorkspace();

  const moved = await moveItem(bread.id, null, snapshotBefore.revision);
  assert.equal(moved.moved, true);
  assert.equal(moved.item.collectionId, null);

  const after = await readWorkspace();
  assert.equal(after.items.find((entry) => entry.id === bread.id).collectionId, null);
  assert.deepEqual(project(after, 'sin-lista').map((row) => row.id), [bread.id]);
  assert.deepEqual(project(after, 'collection:' + list.id).map((row) => row.id).includes(bread.id), false);

  const legacyBread = await Item.get(bread.id);
  assert.equal(legacyBread.listId, list.id);
});

test('workspace moves and legacy writers interleave without losing either side', async () => {
  const { list, milk, bread } = await seedLegacyListWithItems();
  const captured = await captureItem('pan', 'cap-7', 0);
  const eggs = await Item.add({ listId: list.id, label: 'Huevos', text: 'huevos', order: 3 });
  await moveItem('cap-7', list.id, 1);

  const snapshot = await readWorkspace();
  const inCollection = project(snapshot, 'collection:' + list.id).map((row) => row.id);
  assert.equal(inCollection.length, 4);
  for (const id of [bread.id, milk.id, 'cap-7', eggs.id]) assert.ok(inCollection.includes(id));
  assert.equal(inCollection[0], bread.id);
  assert.equal(snapshot.items.find((entry) => entry.id === milk.id).quantity, 2);
  assert.equal((await Item.get(milk.id)).label, 'Leche');
});
