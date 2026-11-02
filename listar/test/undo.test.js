// Purpose: verify pure undo planning: field-level inverses with precondition checks.
// Responsibilities: cover one inverse and one failed-precondition fixture per supported
//   action, A13 stale interleaving with explicit reconfirmation, and refusal to remove
//   changed or missing added items.
// Rationale: undo constructs a new guarded action against current data, reverting only
//   the fields the original action touched; it never restores an old snapshot.
// Fixtures: .wai/projects/listar/plans/2026-11-02-jams-8be5-undo-inverse-precondition-design.org
import test from 'node:test';
import assert from 'node:assert/strict';
import { planUndo } from '../undo.mjs';

const milkBefore = { id: 'i-milk', label: 'Leche', quantity: 2, unit: 'litros', done: false };
const milkAfter = { id: 'i-milk', label: 'Leche', quantity: 3, unit: 'litros', done: false };

test('label inverse reverts only the label', () => {
  const receipt = { action: 'label', itemId: 'i-milk', before: { ...milkBefore, label: 'Leche entera' }, after: { ...milkAfter, label: 'Leche' } };
  const plan = planUndo(receipt, { ...milkAfter, label: 'Leche', attributes: { brand: [] } });
  assert.deepEqual(plan, { ok: true, kind: 'fields', fields: { label: 'Leche entera' } });
});

test('A13: interleaved quantity edit reports stale and reconfirmation applies from before', () => {
  const receipt = { action: 'quantity', itemId: 'i-milk', before: milkBefore, after: milkAfter };
  const drifted = { ...milkAfter, quantity: 5 };
  const stale = planUndo(receipt, drifted);
  assert.equal(stale.ok, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.current.quantity, 5);

  const confirmed = planUndo(receipt, drifted, { confirmStale: true });
  assert.deepEqual(confirmed, { ok: true, kind: 'fields', fields: { quantity: 2, unit: 'litros' } });
});

test('quantity inverse can return to absent values', () => {
  const receipt = {
    action: 'quantity', itemId: 'i-pan',
    before: { id: 'i-pan', label: 'Pan' },
    after: { id: 'i-pan', label: 'Pan', quantity: 2, unit: 'kilos' },
  };
  const plan = planUndo(receipt, { id: 'i-pan', label: 'Pan', quantity: 2, unit: 'kilos' });
  assert.deepEqual(plan, { ok: true, kind: 'fields', fields: { quantity: null, unit: null } });
});

test('A12: completion and archive inverses revert only their flag', () => {
  const completion = planUndo(
    { action: 'completion', itemId: 'i-milk', before: { ...milkBefore, done: false }, after: { ...milkAfter, done: true } },
    { ...milkAfter, done: true },
  );
  assert.deepEqual(completion, { ok: true, kind: 'fields', fields: { done: false } });

  const archive = planUndo(
    { action: 'archive', itemId: 'i-milk', before: { ...milkBefore, archived: false }, after: { ...milkAfter, archived: true } },
    { ...milkAfter, archived: true },
  );
  assert.deepEqual(archive, { ok: true, kind: 'fields', fields: { archived: false } });
});

test('membership inverse restores the previous collection or detaches', () => {
  const receipt = {
    action: 'membership', itemId: 'i-pan',
    before: { id: 'i-pan', label: 'Pan', collectionId: null },
    after: { id: 'i-pan', label: 'Pan', collectionId: 'c-compras' },
  };
  const plan = planUndo(receipt, { id: 'i-pan', label: 'Pan', collectionId: 'c-compras' });
  assert.deepEqual(plan, { ok: true, kind: 'membership', collectionId: null });

  const stale = planUndo(receipt, { id: 'i-pan', label: 'Pan', collectionId: 'c-otra' });
  assert.equal(stale.ok, false);
  assert.equal(stale.stale, true);
  const confirmed = planUndo(receipt, { id: 'i-pan', label: 'Pan', collectionId: 'c-otra' }, { confirmStale: true });
  assert.deepEqual(confirmed, { ok: true, kind: 'membership', collectionId: null });
});

test('added item can be removed only while unchanged; missing or changed targets refuse', () => {
  const receipt = { action: 'capture', itemId: 'i-new', after: { id: 'i-new', label: 'Pan', text: 'pan', done: false } };
  const plan = planUndo(receipt, { id: 'i-new', label: 'Pan', text: 'pan', done: false, collectionId: null });
  assert.deepEqual(plan, { ok: true, kind: 'remove', itemId: 'i-new' });

  const changed = planUndo(receipt, { id: 'i-new', label: 'Pan integral', text: 'pan', done: false, collectionId: null });
  assert.equal(changed.ok, false);
  assert.match(changed.reason, /cambió/i);

  const missing = planUndo(receipt, undefined);
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /no existe/i);
});

test('failed preconditions never fabricate fields', () => {
  const receipt = { action: 'label', itemId: 'i-milk', before: milkBefore, after: milkAfter };
  const plan = planUndo(receipt, undefined);
  assert.equal(plan.ok, false);
  assert.equal(plan.fields, undefined);
});
