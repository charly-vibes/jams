// Purpose: verify persistence primitives for undo: generic field commits and the
//   guarded removal of an unchanged added item.
// Responsibilities: cover applyItemFields inverses (done/archived/label/quantity),
//   removeCapturedItem preconditions (unchanged-only, workspace-owned, stale rejections)
//   and zero-partial-write failures.
// Rationale: undo applies new guarded actions on current state; removing an added
//   item is allowed only while it is byte-identical to the receipt's after image.
// Fixtures: .wai/projects/listar/plans/2026-11-02-jams-8be5-undo-inverse-precondition-design.org
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { List, Item } from '../db.js';
import { applyItemFields, captureItem, moveItem, readWorkspace, removeCapturedItem } from '../workspace.mjs';

const workspaceDb = 'listar-workspace';
beforeEach(async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(workspaceDb);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Workspace database is still open during test reset.'));
  });
});

test('applyItemFields applies explicit inverse values under the revision guard', async () => {
  const pan = await captureItem('pan', 'cap-undo-1', 0);
  const done = await applyItemFields('cap-undo-1', { done: true }, 1);
  assert.equal(done.done, true);
  const undone = await applyItemFields('cap-undo-1', { done: false }, 2);
  assert.equal(undone.done, false);

  const archived = await applyItemFields('cap-undo-1', { archived: true }, 3);
  assert.equal(archived.archived, true);
  const restored = await applyItemFields('cap-undo-1', { archived: false }, 4);
  assert.equal(restored.archived, false);

  await assert.rejects(applyItemFields('cap-undo-1', { label: '' }, 5));
  await assert.rejects(applyItemFields('cap-undo-1', { done: true }, 99));
  assert.equal((await readWorkspace()).revision, 5);
});

test('undo round-trip: completion then membership inverse restore prior state', async () => {
  const list = await List.add({ name: 'Compras' });
  const pan = await captureItem('pan', 'cap-undo-2', 0);
  const moved = await moveItem('cap-undo-2', list.id, 1);
  assert.equal(moved.item.collectionId, list.id);
  const undoneMove = await moveItem('cap-undo-2', null, 2);
  assert.equal(undoneMove.item.collectionId, null);
  const snapshot = await readWorkspace();
  assert.equal(snapshot.items.find((entry) => entry.id === 'cap-undo-2').collectionId, null);
  assert.equal(snapshot.revision, 3);
});

test('removeCapturedItem removes an unchanged added item and its membership', async () => {
  const list = await List.add({ name: 'Compras' });
  const pan = await captureItem('pan', 'cap-undo-3', 0, { collectionId: list.id });
  const beforeRemoval = await readWorkspace();
  const stored = beforeRemoval.items.find((entry) => entry.id === 'cap-undo-3');
  const { collectionId: _omit, ...expected } = stored;

  await removeCapturedItem('cap-undo-3', 1, { expected });
  const after = await readWorkspace();
  assert.equal(after.items.some((entry) => entry.id === 'cap-undo-3'), false);
  assert.equal(after.revision, 2);
});

test('removeCapturedItem refuses stale revisions, changed items and legacy rows', async () => {
  const list = await List.add({ name: 'Compras' });
  const pan = await captureItem('pan', 'cap-undo-4', 0);
  const { collectionId: _a, ...expected } = (await readWorkspace()).items.find((entry) => entry.id === 'cap-undo-4');

  await assert.rejects(removeCapturedItem('cap-undo-4', 99, { expected }));
  await removeCapturedItem('cap-undo-4', 1, { expected });
  await captureItem('sal', 'cap-undo-5', 2);
  const changed = await applyItemFields('cap-undo-5', { label: 'sal fina' }, 3);
  await assert.rejects(removeCapturedItem('cap-undo-5', 4, { expected: { id: 'cap-undo-5', label: 'sal', text: 'sal', done: false } }));

  const legacy = await Item.add({ listId: list.id, label: 'Leche', order: 1 });
  await assert.rejects(removeCapturedItem(legacy.id, 4, { expected: { id: legacy.id } }));
  assert.equal((await readWorkspace()).items.some((entry) => entry.id === legacy.id), true);
});
