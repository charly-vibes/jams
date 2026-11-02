// Purpose: verify guarded item edits, completion and archive/restore across workspace
//   and legacy-owned items.
// Responsibilities: cover A03 quantity editing with identity/attribute preservation,
//   no-op and invalid-patch rejection, completion changing only done, archive changing
//   only archive state, and zero-partial-write failure paths.
// Rationale: corrections preserve entity IDs, raw source and unrelated attributes;
//   completion, membership, archive state and labels are independent fields.
// Fixtures: .wai/projects/listar/plans/2026-11-02-jams-8be3-edit-complete-archive-fixture-design.org
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { List, Item } from '../db.js';
import {
  applyItemUpdate, captureItem, moveItem, readWorkspace, setArchived, toggleDone,
} from '../workspace.mjs';
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

async function seedLegacyMilk() {
  const list = await List.add({ name: 'Compras' });
  const milk = await Item.add({
    listId: list.id, label: 'Leche', text: 'dos litros de leche', quantity: 2, unit: 'litros', order: 1,
    attributes: {
      brand: [{
        id: 'a-brand-1', role: 'observation',
        value: { type: 'brand', name: 'La Serenísima' },
        evidence: { source: 'user statement' },
      }],
    },
  });
  return { list, milk };
}

test('A03: changing milk 2 L to 3 L keeps exactly 1 original item ID and all unrelated fields', async () => {
  const { milk } = await seedLegacyMilk();
  const before = structuredClone((await readWorkspace()).items.find((entry) => entry.id === milk.id));

  const updated = await applyItemUpdate(milk.id, { quantity: 3 }, 0);
  assert.equal(updated.id, milk.id);
  assert.equal(updated.quantity, 3);
  assert.equal(updated.unit, 'litros');

  const after = (await readWorkspace()).items.find((entry) => entry.id === milk.id);
  const unchanged = { ...after, quantity: before.quantity };
  assert.deepEqual(unchanged, before);
  assert.deepEqual(after.attributes, before.attributes);
  assert.equal((await readWorkspace()).items.filter((entry) => entry.label === 'Leche').length, 1);
});

test('label edits and quantity clearing keep absent fields absent', async () => {
  const pan = await captureItem('pan', 'cap-edit-1', 0);
  const renamed = await applyItemUpdate('cap-edit-1', { label: 'pan integral' }, 1);
  assert.equal(renamed.label, 'pan integral');
  assert.equal(Object.hasOwn(renamed, 'quantity'), false);
  assert.equal(Object.hasOwn(renamed, 'unit'), false);

  const withQty = await applyItemUpdate('cap-edit-1', { quantity: 2, unit: 'kilos' }, 2);
  assert.equal(withQty.quantity, 2);
  const cleared = await applyItemUpdate('cap-edit-1', { quantity: null, unit: null }, 3);
  assert.equal(Object.hasOwn(cleared, 'quantity'), false);
  assert.equal(Object.hasOwn(cleared, 'unit'), false);
});

test('same-value patches are no-ops; invalid patches and stale revisions reject with zero writes', async () => {
  const pan = await captureItem('pan', 'cap-edit-2', 0);
  const noop = await applyItemUpdate('cap-edit-2', { label: 'pan' }, 1);
  assert.equal(noop.label, 'pan');
  assert.equal((await readWorkspace()).revision, 1);

  await assert.rejects(applyItemUpdate('cap-edit-2', { label: '   ' }, 1));
  await assert.rejects(applyItemUpdate('cap-edit-2', { quantity: Number.NaN }, 1));
  await assert.rejects(applyItemUpdate('cap-edit-2', { quantity: 0 }, 1));
  await assert.rejects(applyItemUpdate('cap-edit-2', { label: 'pan fresco' }, 99));

  const snapshot = await readWorkspace();
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.items.find((entry) => entry.id === 'cap-edit-2').label, 'pan');
});

test('completion changes only done and archive changes only archive state', async () => {
  const { list, milk } = await seedLegacyMilk();
  await captureItem('pan', 'cap-edit-3', 0);
  const milkBefore = structuredClone((await readWorkspace()).items.find((entry) => entry.id === milk.id));

  const done = await toggleDone('cap-edit-3', 1);
  assert.equal(done.done, true);
  assert.equal(project(await readWorkspace(), 'pendientes').some((row) => row.id === 'cap-edit-3'), false);
  assert.equal(project(await readWorkspace(), 'completados').some((row) => row.id === 'cap-edit-3'), true);

  const archived = await setArchived(milk.id, true, 2);
  assert.equal(archived.archived, true);
  const milkAfter = (await readWorkspace()).items.find((entry) => entry.id === milk.id);
  const { archived: _a, ...milkRest } = milkAfter;
  const { archived: _b, ...milkBeforeRest } = milkBefore;
  assert.deepEqual(milkRest, milkBeforeRest);
  const snapshot = await readWorkspace();
  assert.equal(project(snapshot, 'todo').some((row) => row.id === milk.id), false);
  assert.equal(project(snapshot, 'collection:' + list.id).some((row) => row.id === milk.id), false);
  assert.equal(project(snapshot, 'archivados').some((row) => row.id === milk.id), true);

  const restored = await setArchived(milk.id, false, 3);
  assert.equal(restored.archived, false);
  assert.equal(project(await readWorkspace(), 'pendientes').some((row) => row.id === milk.id), true);
  assert.equal(project(await readWorkspace(), 'collection:' + list.id).some((row) => row.id === milk.id), true);
});

test('A15: failed completion keeps prior state with zero partial writes', async () => {
  await captureItem('pan', 'cap-edit-4', 0);
  await assert.rejects(toggleDone('cap-edit-4', 42));
  const snapshot = await readWorkspace();
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.items.find((entry) => entry.id === 'cap-edit-4').done, false);
  await assert.rejects(setArchived('cap-edit-4', true, 42));
  assert.equal(Object.hasOwn((await readWorkspace()).items.find((entry) => entry.id === 'cap-edit-4'), 'archived'), false);
});

test('workspace membership survives item edits', async () => {
  const list = await List.add({ name: 'Compras' });
  await captureItem('pan', 'cap-edit-5', 0, { collectionId: list.id });
  const edited = await applyItemUpdate('cap-edit-5', { label: 'pan rallado' }, 1);
  assert.equal(edited.label, 'pan rallado');
  const snapshot = await readWorkspace();
  assert.equal(snapshot.items.find((entry) => entry.id === 'cap-edit-5').collectionId, list.id);
  assert.deepEqual(project(snapshot, 'collection:' + list.id).map((row) => row.id), ['cap-edit-5']);
  const moved = await moveItem('cap-edit-5', null, 2);
  assert.equal(moved.item.collectionId, null);
});
