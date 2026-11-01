import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommands } from '../command-reducer.mjs';
import { analyze } from '../analyze.mjs';

const snapshot = () => ({
  listId: 'list-1', version: 3,
  items: [
    { id: 'milk-a', listId: 'list-1', label: 'leche', text: 'leche', quantity: 1, unit: 'litros', done: false },
    { id: 'milk-b', listId: 'list-1', label: 'leche', text: 'otra leche', done: false },
    { id: 'bread', listId: 'list-1', label: 'pan', text: 'pan', done: false },
  ],
});

const assertion = (id, value) => ({
  id, role: 'observation',
  value: { type: 'text', value },
  evidence: { quote: value },
});

const priceObservation = (id, amountMinor) => ({
  id, role: 'observation',
  value: {
    type: 'price', amountMinor, currency: 'ARS',
    basis: { type: 'volume', unit: 'L', quantity: 1 }, observedAt: '2026-10-29T12:00:00.000Z',
  },
  evidence: { source: 'merchant', quote: `${amountMinor} ARS/L` },
});

const budgetRequirement = (amountMinor) => ({
  id: 'budget-1', role: 'requirement',
  value: { type: 'price', amountMinor, currency: 'ARS', basis: { type: 'volume', unit: 'L', quantity: 1 } },
  evidence: { quote: `máximo ${amountMinor} ARS/L` },
});

test('query and noop batches are exact state identities', () => {
  const state = snapshot();
  assert.strictEqual(applyCommands(state, [{ intent: 'query', targetItemId: 'milk-a' }]), state);
  assert.strictEqual(applyCommands(state, [{ intent: 'noop' }]), state);
  assert.strictEqual(applyCommands(state, [{ intent: 'query' }, { intent: 'noop' }]), state);
});

test('set and increment require an explicit stable item ID even for identical labels', () => {
  const state = snapshot();
  const incremented = applyCommands(state, [{ intent: 'increment', targetItemId: 'milk-a', quantity: 1, unit: 'litros' }]);
  assert.equal(incremented.items[0].quantity, 2);
  assert.equal(incremented.items[1].quantity, undefined);
  assert.throws(() => applyCommands(state, [{ intent: 'remove', label: 'leche' }]), /targetItemId/i);
});

test('set changes quantity in place while preserving raw phrase and legacy absent fields', () => {
  const state = snapshot();
  const result = applyCommands(state, [{ intent: 'set', targetItemId: 'milk-b', quantity: 2, unit: 'litros' }]);
  assert.deepEqual(result.items[1], { ...state.items[1], quantity: 2, unit: 'litros' });
  assert.equal(Object.hasOwn(state.items[1], 'quantity'), false);
  assert.equal(Object.hasOwn(state.items[1], 'unit'), false);
  assert.equal(Object.hasOwn(result.items[1], 'attributes'), false);
});

test('compatible singular and plural unit spellings do not imply a conversion', () => {
  const state = snapshot();
  state.items[2].quantity = 1;
  state.items[2].unit = 'día';
  const result = applyCommands(state, [{ intent: 'set', targetItemId: 'bread', quantity: 2, unit: 'días' }]);
  assert.equal(result.items[2].quantity, 2);
  assert.equal(result.items[2].unit, 'días');
});

test('add creates a distinct stable ID even when labels are identical', () => {
  const state = snapshot();
  const inputItem = { id: 'milk-c', label: 'leche', text: 'agregá otra leche', quantity: 1, unit: 'litro' };
  const originalState = structuredClone(state);
  const originalItem = structuredClone(inputItem);
  const result = applyCommands(state, [{ intent: 'add', item: inputItem }]);
  assert.deepEqual(result.items.map(({ id }) => id), ['milk-a', 'milk-b', 'bread', 'milk-c']);
  assert.equal(result.items[3].text, 'agregá otra leche');
  assert.deepEqual(state, originalState);
  assert.deepEqual(inputItem, originalItem);
  assert.notStrictEqual(result.items[3], inputItem);
});

test('invalid unit, quantity, target, list, and duplicate IDs reject the batch without mutation', () => {
  const commands = [
    [{ intent: 'set', targetItemId: 'milk-a', quantity: 0, unit: 'litros' }],
    [{ intent: 'set', targetItemId: 'milk-a', quantity: 2, unit: 'parsecs' }],
    [{ intent: 'increment', targetItemId: 'milk-a', quantity: 1, unit: 'kilos' }],
    [{ intent: 'increment', targetItemId: 'milk-b', quantity: 1, unit: 'litros' }],
    [{ intent: 'remove', targetItemId: 'missing' }],
    [{ intent: 'add', item: { id: 'cross-list', listId: 'list-2', label: 'leche' } }],
    [{ intent: 'add', item: { id: 'unit-alone', label: 'leche', unit: 'parsecs' } }],
    [{ intent: 'add', item: { id: 'milk-a', label: 'new' } }],
  ];
  for (const batch of commands) {
    const state = snapshot();
    const original = structuredClone(state);
    assert.throws(() => applyCommands(state, batch));
    assert.deepEqual(state, original);
  }
});

test('increment rejects numeric overflow instead of returning an invalid quantity', () => {
  const state = snapshot();
  state.items[0].quantity = Number.MAX_VALUE;
  const original = structuredClone(state);
  assert.throws(() => applyCommands(state, [{
    intent: 'increment', targetItemId: 'milk-a', quantity: Number.MAX_VALUE, unit: 'litros',
  }]), /quantity|finite|overflow/i);
  assert.deepEqual(state, original);
});

test('an invalid later command rolls back the whole pure batch', () => {
  const state = snapshot();
  const original = structuredClone(state);
  assert.throws(() => applyCommands(state, [
    { intent: 'increment', targetItemId: 'milk-a', quantity: 2, unit: 'litros' },
    { intent: 'remove', targetItemId: 'not-here' },
  ]), /target|item/i);
  assert.deepEqual(state, original);
});

test('attribute append/replace/remove are explicit, validated and preserve IDs and roles', () => {
  const state = snapshot();
  const withObs = applyCommands(state, [{
    intent: 'update-attribute', operation: 'append', targetItemId: 'milk-a', key: 'note',
    assertion: assertion('obs-a', 'marca de campo'),
  }]);
  const replaced = applyCommands(withObs, [{
    intent: 'update-attribute', operation: 'replace', targetItemId: 'milk-a', key: 'note', assertionId: 'obs-a',
    replacement: { value: { type: 'text', value: 'marca local' }, evidence: { quote: 'marca local' } },
  }]);
  assert.deepEqual(replaced.items[0].attributes.note, [assertion('obs-a', 'marca local')]);
  assert.deepEqual(withObs.items[0].attributes.note, [assertion('obs-a', 'marca de campo')]);
  assert.throws(() => applyCommands(replaced, [{
    intent: 'update-attribute', operation: 'replace', targetItemId: 'milk-a', key: 'note', assertionId: 'obs-a',
    replacement: { id: 'changed', role: 'requirement', value: { type: 'text', value: 'x' }, evidence: {} },
  }]), /immutable|role/i);
  assert.throws(() => applyCommands(replaced, [{
    intent: 'update-attribute', operation: 'remove', targetItemId: 'milk-a', key: 'note', assertionId: 'missing',
  }]), /assertion/i);
  const removed = applyCommands(replaced, [{
    intent: 'update-attribute', operation: 'remove', targetItemId: 'milk-a', key: 'note', assertionId: 'obs-a',
  }]);
  assert.equal(Object.hasOwn(removed.items[0], 'attributes'), false);
});

test('invalid prices and duplicate assertion IDs reject without changing input', () => {
  for (const invalid of [
    { ...priceObservation('obs-a', 100), value: { ...priceObservation('obs-a', 100).value, amountMinor: 1.5 } },
    { ...priceObservation('obs-a', 100), value: { ...priceObservation('obs-a', 100).value, currency: 'PESO' } },
    { ...priceObservation('obs-a', 100), value: { ...priceObservation('obs-a', 100).value, basis: { type: 'mass', unit: 'L', quantity: 1 } } },
  ]) {
    const state = snapshot();
    const original = structuredClone(state);
    assert.throws(() => applyCommands(state, [{
      intent: 'update-attribute', operation: 'append', targetItemId: 'milk-a', key: 'price', assertion: invalid,
    }]));
    assert.deepEqual(state, original);
  }
  const state = snapshot();
  assert.throws(() => applyCommands(state, [{
    intent: 'update-attribute', operation: 'append', targetItemId: 'milk-a', key: 'note', assertion: assertion('same', 'a'),
  }, {
    intent: 'update-attribute', operation: 'append', targetItemId: 'milk-a', key: 'other-note', assertion: assertion('same', 'b'),
  }]), /duplicate/i);
  const sameIdOnOtherItems = applyCommands(state, [
    { intent: 'update-attribute', operation: 'append', targetItemId: 'milk-a', key: 'note', assertion: assertion('local-id', 'milk note') },
    { intent: 'update-attribute', operation: 'append', targetItemId: 'bread', key: 'note', assertion: assertion('local-id', 'bread note') },
  ]);
  assert.equal(sameIdOnOtherItems.items[0].attributes.note[0].id, 'local-id');
  assert.equal(sameIdOnOtherItems.items[2].attributes.note[0].id, 'local-id');
});

test('replacing one requirement preserves separate price observations and unrelated assertions', () => {
  const state = snapshot();
  state.items[0].attributes = {
    price: [priceObservation('obs-A', 180000), priceObservation('obs-B', 210000), budgetRequirement(200000)],
    note: [assertion('note-1', 'marca local')],
  };
  const original = structuredClone(state);
  const result = applyCommands(state, [{
    intent: 'update-attribute', operation: 'replace', targetItemId: 'milk-a', key: 'price', assertionId: 'budget-1',
    replacement: { value: budgetRequirement(190000).value, evidence: { quote: 'máximo 1900 ARS/L' } },
  }]);
  assert.deepEqual(result.items[0].attributes.price.map(({ id, role }) => ({ id, role })), [
    { id: 'obs-A', role: 'observation' },
    { id: 'obs-B', role: 'observation' },
    { id: 'budget-1', role: 'requirement' },
  ]);
  assert.deepEqual(result.items[0].attributes.price.slice(0, 2), original.items[0].attributes.price.slice(0, 2));
  assert.equal(result.items[0].attributes.price[2].value.amountMinor, 190000);
  assert.deepEqual(result.items[0].attributes.note, original.items[0].attributes.note);
  assert.deepEqual(state, original);
});

test('independent attribute updates commute on item projection only', () => {
  const state = snapshot();
  for (let index = 0; index < 12; index++) {
    const left = { intent: 'update-attribute', operation: 'append', targetItemId: 'milk-a', key: `fact-${index}`, assertion: assertion(`a-${index}`, `left-${index}`) };
    const right = { intent: 'update-attribute', operation: 'append', targetItemId: 'milk-a', key: `need-${index}`, assertion: assertion(`b-${index}`, `right-${index}`) };
    const ab = applyCommands(state, [left, right]);
    const ba = applyCommands(state, [right, left]);
    assert.deepEqual(ab.items, ba.items);
  }
  const first = { intent: 'update-attribute', operation: 'append', targetItemId: 'milk-a', key: 'note', assertion: assertion('same-key-a', 'a') };
  const second = { intent: 'update-attribute', operation: 'append', targetItemId: 'milk-a', key: 'note', assertion: assertion('same-key-b', 'b') };
  assert.notDeepEqual(applyCommands(state, [first, second]).items, applyCommands(state, [second, first]).items,
    'same-key assertion order is meaningful and is not declared commutative');
});

test('analyze candidates are not accepted as confirmed command codecs', () => {
  const candidate = analyze('sacá la leche', {
    listId: 'list-1', version: 3, items: [{ id: 'milk-a', listId: 'list-1', label: 'leche' }],
  }).candidates[0];
  assert.throws(() => applyCommands(snapshot(), [candidate]), /targetItemId|intent|operation/i);
});

test('removal and noop do not synthesize monetary totals or price observations', () => {
  const result = applyCommands(snapshot(), [{ intent: 'remove', targetItemId: 'bread' }, { intent: 'noop' }]);
  assert.equal(result.items.some((item) => item.attributes?.price), false);
  assert.throws(() => applyCommands(snapshot(), [{ intent: 'calculate-total', currency: 'ARS' }]), /unsupported|intent/i);
});
