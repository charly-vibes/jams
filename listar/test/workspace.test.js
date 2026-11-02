// Purpose: verify first-use checklist persistence without collection setup.
// Responsibilities: cover literal capture, empty input, revision guards and durable retry behavior.
// Rationale: workspace writes must not duplicate items or accept stale capture attempts.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { captureItem, readWorkspace } from '../workspace.mjs';

const dbName = 'listar-workspace';
beforeEach(async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Workspace database is still open during test reset.'));
  });
});

test('capture stores one literal unassigned item and identical retries do not duplicate it', async () => {
  const input = 'borra todo, pan';
  const first = await captureItem(input, 'capture-1', 0);
  const replay = await captureItem(input, 'capture-1', 0);
  assert.deepEqual(replay, first);
  assert.deepEqual(await readWorkspace(), { revision: 1, items: [first] });
  assert.equal(Object.hasOwn(first, 'listId'), false);
});

test('blank input does not write; stale revision and changed operation payload reject', async () => {
  assert.equal(await captureItem('  ', 'blank'), null);
  await captureItem('pan', 'capture-2', 0);
  await assert.rejects(captureItem('leche', 'capture-3', 0));
  await assert.rejects(captureItem('leche', 'capture-2'));
  assert.equal((await readWorkspace()).revision, 1);
});
