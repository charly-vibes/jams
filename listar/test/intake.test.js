// Purpose: verify durable shared-audio intake records, recovery planning, and commit identity rules.
// Responsibilities: cover the intakes store with the v3 upgrade, planRecovery resume/finish
//   partitioning, nextOperationIdentity replacement rules, and workspace receipt reads.
// Rationale: acknowledged share handoffs must survive reload, resume review with the same
//   identity when uncommitted, and finish cleanup idempotently once a commit receipt exists.
// Fixtures: .wai/projects/listar/plans/2026-11-02-jams-8be8-durable-intake-fixture-design.org
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { Intake, DB_NAME, DB_VERSION, List, Item } from '../db.js';
import { planRecovery, nextOperationIdentity } from '../intake.mjs';

async function deleteDatabases() {
  for (const name of ['listar-workspace', DB_NAME]) {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error(`Test left ${name} connection open`));
    });
  }
}

beforeEach(async () => { await deleteDatabases(); });

test('A16/I1/I4: intake records round-trip durably and discard removes exactly the record', async () => {
  assert.equal(DB_VERSION, 3);
  await Intake.save({ token: 'tok-1', createdAt: 1, status: 'pending' });
  await Intake.save({ token: 'tok-2', createdAt: 2, status: 'pending' });
  assert.deepEqual((await Intake.getAll()).map((entry) => entry.token), ['tok-1', 'tok-2']);
  assert.deepEqual(await Intake.get('tok-1'), { token: 'tok-1', createdAt: 1, status: 'pending' });
  await Intake.remove('tok-1');
  assert.deepEqual((await Intake.getAll()).map((entry) => entry.token), ['tok-2']);
  await Intake.remove('tok-1');
  assert.equal((await Intake.getAll()).length, 1);
});

test('I6: a second handoff queues behind the first with both records durable', async () => {
  await Intake.save({ token: 'tok-a', createdAt: 1, status: 'pending' });
  await Intake.save({ token: 'tok-b', createdAt: 2, status: 'pending' });
  const pending = await Intake.getAll();
  assert.equal(pending.length, 2);
  assert.equal(pending.filter((entry) => entry.status === 'pending').length, 2);
});

test('v3 upgrade adds the intakes store preserving existing lists and items', async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = ({ target }) => {
      const db = target.result;
      db.createObjectStore('lists', { keyPath: 'id' });
      const items = db.createObjectStore('items', { keyPath: 'id' });
      items.createIndex('listId', 'listId');
      db.createObjectStore('audio', { keyPath: 'id' });
      db.createObjectStore('operations', { keyPath: 'operationId' });
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['lists', 'items'], 'readwrite');
      tx.objectStore('lists').put({ id: 'l-1', name: 'Vieja', emoji: '', order: 1, version: 0 });
      tx.objectStore('items').put({ id: 'i-1', listId: 'l-1', label: 'Leche', done: false, order: 1 });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });

  const list = await List.get('l-1');
  assert.equal(list.name, 'Vieja');
  assert.equal((await Item.get('i-1')).label, 'Leche');
  await Intake.save({ token: 'after-upgrade', createdAt: 9, status: 'pending' });
  assert.deepEqual((await Intake.getAll()).map((entry) => entry.token), ['after-upgrade']);
});

test('I2/I3: recovery resumes uncommitted intakes and finishes committed ones by receipt', () => {
  const intakes = [
    { token: 't1', status: 'pending' },
    { token: 't2', status: 'pending', operationId: 'op-2', payload: [{ kind: 'add' }] },
    { token: 't3', status: 'committed', operationId: 'op-3' },
    { token: 't4', status: 'committed', operationId: 'op-4' },
  ];
  const { resume, finish } = planRecovery(intakes, ['op-4']);
  assert.deepEqual(finish.map((entry) => entry.token), ['t4']);
  assert.deepEqual(resume.map((entry) => entry.token), ['t1', 't2', 't3']);
  // A committed-marked intake without a receipt keeps the SAME identity for retry.
  const retrying = resume.find((entry) => entry.token === 't3');
  assert.equal(retrying.operationId, 'op-3');
  assert.deepEqual(planRecovery([], []), { resume: [], finish: [] });
});

test('I5/I7: identity is never replaced while the outcome is unknown; new ID only after definitive failure with edits', () => {
  assert.equal(nextOperationIdentity(null, { idFactory: () => 'fresh-1' }), 'fresh-1');
  const frozen = { operationId: 'op-9', payload: [{ kind: 'add', label: 'pan' }] };
  assert.equal(nextOperationIdentity(frozen, { failed: false, edited: true, idFactory: () => 'nope' }), 'op-9');
  assert.equal(nextOperationIdentity(frozen, { failed: true, edited: false, idFactory: () => 'nope' }), 'op-9');
  assert.equal(nextOperationIdentity(frozen, { failed: true, edited: true, idFactory: () => 'fresh-2' }), 'fresh-2');
});

test('receiptFor reads durable commit receipts from the workspace operations store', async () => {
  const { captureItem, receiptFor } = await import('../workspace.mjs');
  await captureItem('pan', 'op-receipt-1', 0);
  const receipt = await receiptFor('op-receipt-1');
  assert.equal(receipt.item.id, 'op-receipt-1');
  assert.equal(await receiptFor('missing-op'), null);
});
