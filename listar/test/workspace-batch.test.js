// Purpose: verify the guarded batch capture for reviewed drafts.
// Responsibilities: cover atomic multi-item persistence, destination membership,
//   operation replay after reopen, changed-payload rejection and stale guards
//   with zero partial writes.
// Rationale: A02 needs one atomic batch, A04 exact intended values with preserved
//   raw text, and A14 identical retry after reopen must return the original
//   outcome without duplicating items.

import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { captureBatch, captureItem, createCollection, readWorkspace } from '../workspace.mjs';
import { project } from '../views.mjs';

const dbName = 'listar-workspace';
async function resetWorkspace() {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Workspace database is still open during test reset.'));
  });
}

test('A02: three-item dictation persists 0 items before Agregar 3 and exactly 3 in one atomic batch', async () => {
  await resetWorkspace();
  const before = await readWorkspace();
  assert.equal(before.items.length, 0, 'nothing is persisted before the explicit confirmation');
  const proposals = [
    { label: 'leche', text: 'leche' },
    { label: 'pan', text: 'pan' },
    { label: 'huevos', text: 'huevos' },
  ];
  const items = await captureBatch(proposals, 'batch-a02', before.revision);
  assert.equal(items.length, 3);
  const after = await readWorkspace();
  assert.equal(after.items.length, 3);
  assert.equal(after.revision, 1, 'the whole batch is one revision bump');
  assert.deepEqual(after.items.map((item) => [item.label, item.done, item.collectionId]), [
    ['leche', false, null], ['pan', false, null], ['huevos', false, null],
  ]);
});

test('A04: corrected labels save intended values with raw source text and no merges', async () => {
  await resetWorkspace();
  const proposals = [
    { label: 'leche deslactosada', text: 'leche' },
    { label: 'huevos', text: 'huevos' },
  ];
  await captureBatch(proposals, 'batch-a04', 0);
  const snapshot = await readWorkspace();
  assert.equal(snapshot.items.length, 2);
  const leche = snapshot.items.find((item) => item.label === 'leche deslactosada');
  assert.equal(leche.text, 'leche', 'raw source phrase is preserved on the corrected item');
  assert.ok(!snapshot.items.some((item) => item.label === 'leche' && item.text === 'leche'), 'no silent merge keeps the old label');
});

test('A14: identical retry after reopen returns the original outcome without duplicates', async () => {
  await resetWorkspace();
  const proposals = [
    { label: 'leche', text: 'leche', quantity: 2, unit: 'litros' },
    { label: 'pan', text: 'pan' },
    { label: 'huevos', text: 'huevos' },
  ];
  const first = await captureBatch(proposals, 'batch-a14', 0);
  const replay = await captureBatch(proposals, 'batch-a14', 0);
  assert.deepEqual(replay, first, 'same operation ID and payload return the original items');
  assert.equal(replay[0].quantity, 2);
  assert.equal(replay[0].unit, 'litros');
  const snapshot = await readWorkspace();
  assert.equal(snapshot.items.length, 3, 'exactly three items persist after the repeated confirmation');
  assert.equal(snapshot.revision, 1, 'replay does not advance the revision');
});

test('A14: changed payload with a reused operation ID rejects and writes nothing', async () => {
  await resetWorkspace();
  const proposals = [
    { label: 'leche', text: 'leche' },
    { label: 'pan', text: 'pan' },
  ];
  await captureBatch(proposals, 'batch-reuse', 0);
  await assert.rejects(
    captureBatch([{ label: 'leche', text: 'leche' }, { label: 'yogur', text: 'yogur' }], 'batch-reuse', 1),
    /diferente|differ/i,
  );
  const snapshot = await readWorkspace();
  assert.deepEqual(snapshot.items.map((item) => item.label), ['leche', 'pan']);
  assert.equal(snapshot.revision, 1);
});

test('stale revision rejects the batch with zero partial writes', async () => {
  await resetWorkspace();
  await captureItem('sal', 'capture-stale', 0);
  const proposals = [{ label: 'leche', text: 'leche' }, { label: 'pan', text: 'pan' }];
  await assert.rejects(captureBatch(proposals, 'batch-stale', 0), /actualizó|stale/i);
  const snapshot = await readWorkspace();
  assert.deepEqual(snapshot.items.map((item) => item.label), ['sal'], 'no partial batch items are written');
  assert.equal(snapshot.revision, 1);
});

test('empty or blank-label batches never write', async () => {
  await resetWorkspace();
  await assert.rejects(captureBatch([], 'batch-empty', 0), TypeError);
  await assert.rejects(captureBatch([{ label: '   ', text: '   ' }], 'batch-blank', 0), TypeError);
  await assert.rejects(captureBatch([{ label: 'leche', quantity: 0 }], 'batch-qty', 0), TypeError);
  assert.equal((await readWorkspace()).revision, 0);
});

test('batches of any size keep dictation order under the deterministic sort', async () => {
  await resetWorkspace();
  const proposals = Array.from({ length: 12 }, (_, index) => ({ label: `artículo ${index + 1}`, text: `artículo ${index + 1}` }));
  await captureBatch(proposals, 'batch-order', 0);
  const snapshot = await readWorkspace();
  const rows = project(snapshot, 'todo');
  assert.deepEqual(rows.map((item) => item.label), proposals.map((row) => row.label));
});

test('batch destination records one membership per item and rejects unknown collections', async () => {
  await resetWorkspace();
  const collection = await createCollection({ name: 'Compras' }, 0);
  const proposals = [{ label: 'leche', text: 'leche' }, { label: 'pan', text: 'pan' }];
  await captureBatch(proposals, 'batch-dest', 1, { collectionId: collection.id });
  const snapshot = await readWorkspace();
  assert.ok(snapshot.items.every((item) => item.collectionId === collection.id));
  await assert.rejects(captureBatch([{ label: 'yogur' }], 'batch-unknown', 2, { collectionId: 'missing' }), TypeError);
  assert.equal((await readWorkspace()).items.length, 2);
});
