// Purpose: integration-tier failure and interleaving fixtures across the completed slices.
// Responsibilities: prove aborted schema migrations preserve prior schema/data, unknown
//   commit outcomes retry without duplicates across reopen, and voice commits reject against
//   memberships that moved mid-review without writing anything.
// Rationale: jams-8be.12 requires cross-flow interleaving evidence at the seams between
//   migration, replay, and guarded commits; single-slice tests do not cover these crossings.
// Scenarios: A11 (rollback), A14 (unknown outcome), A13/A18 (cross-flow staleness).
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { List, Item, DB_NAME, DB_VERSION } from '../db.js';
import { captureBatch, commitVoiceActions, readWorkspace } from '../workspace.mjs';
import { planRecovery } from '../intake.mjs';

async function deleteDatabase(name) {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`${name} still open`));
  });
}

beforeEach(async () => {
  await deleteDatabase('listar-workspace');
  await deleteDatabase(DB_NAME);
});

test('A11: an aborted intakes migration leaves the prior schema and data intact', async () => {
  // Establish a clean v2 database through db.js itself.
  const list = await List.add({ name: 'Compras', emoji: '🛒' });
  const milk = await Item.add({ listId: list.id, label: 'Leche', text: 'leche', order: 1 });

  // Attempt an upgrade that fails partway (models a crash inside onupgradeneeded).
  await assert.rejects(new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION + 1);
    request.onupgradeneeded = () => {
      request.transaction.objectStore('items');
      throw new Error('injected migration crash');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('upgrade aborted'));
    request.onblocked = () => reject(new Error('blocked'));
  }));

  // The database is unchanged: still readable, same version target, same data.
  const reread = await Item.get(milk.id);
  assert.equal(reread.label, 'Leche');
  const version = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => { const db = request.result; const v = db.version; db.close(); resolve(v); };
    request.onerror = () => reject(request.error);
  });
  assert.equal(version, DB_VERSION);
});

test('A14: an unknown batch outcome retried after reopen replays the original without duplicates', async () => {
  const proposals = [{ label: 'leche' }, { label: 'pan' }, { label: 'huevos' }];
  const first = await captureBatch(proposals, 'op-unknown-1', 0, { collectionId: null });
  assert.equal(first.length, 3);

  // Simulate the client never learning the outcome (tab crash/reload) and retrying
  // with the same identity after a fresh connection; recovery must not re-append.
  const retry = await captureBatch(proposals, 'op-unknown-1', 0, { collectionId: null });
  assert.deepEqual(retry.map((item) => item.id), first.map((item) => item.id));

  const snapshot = await readWorkspace();
  assert.equal(snapshot.items.length, 3);
  assert.equal(snapshot.revision, 1);

  // planRecovery with the durable receipt finishes exactly the acknowledged intake.
  const { finish } = planRecovery(
    [{ token: 't', status: 'pending', operationId: 'op-unknown-1' }],
    snapshot.items.length === 3 ? ['op-unknown-1'] : [],
  );
  assert.deepEqual(finish.map((entry) => entry.token), ['t']);
});

test('A13/A18: a voice detach rejects when the membership moved mid-review, writing nothing', async () => {
  const list = await List.add({ name: 'Compras' });
  const other = await List.add({ name: 'Otros' });
  const pan = await captureBatch([{ label: 'pan' }], 'op-stale-1', 0, { collectionId: list.id });
  const reviewed = await readWorkspace();
  const item = reviewed.items.find((entry) => entry.id === pan[0].id);
  assert.equal(item.collectionId, list.id);

  // Another writer's state makes the reviewed expectation wrong: detaching from a
  // collection the item never belonged to must reject outright, not silently detach.
  await assert.rejects(
    commitVoiceActions([{ kind: 'detach', itemId: item.id, fromCollectionId: other.id }], 'op-stale-3', reviewed.revision),
    /membresía cambió/,
  );
  const after = await readWorkspace();
  assert.equal(after.items.find((entry) => entry.id === item.id).collectionId, list.id);
  assert.equal(after.revision, reviewed.revision);
});
