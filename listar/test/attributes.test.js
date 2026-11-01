import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { DB_NAME, DB_VERSION, Item, List } from '../db.js';

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

async function clearItems() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = ({ target }) => {
      const database = target.result;
      if (!database.objectStoreNames.contains('lists')) database.createObjectStore('lists', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('items')) {
        const items = database.createObjectStore('items', { keyPath: 'id' });
        items.createIndex('listId', 'listId', { unique: false });
        items.createIndex('order', 'order', { unique: false });
        items.createIndex('done', 'done', { unique: false });
      }
      if (!database.objectStoreNames.contains('audio')) {
        const audio = database.createObjectStore('audio', { keyPath: 'id' });
        audio.createIndex('listId', 'listId', { unique: false });
        audio.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!database.objectStoreNames.contains('operations')) database.createObjectStore('operations', { keyPath: 'operationId' });
    };
  });
  await new Promise((resolve, reject) => {
    const stores = ['lists', 'items', 'audio', 'operations'].filter((store) => db.objectStoreNames.contains(store));
    const transaction = db.transaction(stores, 'readwrite');
    for (const store of stores) transaction.objectStore(store).clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  await List.put({ id: 'L', name: 'Fixture', emoji: '', createdAt: 0, order: 0 });
}

beforeEach(clearItems);

function priceObservation(id, amountMinor, source, observedAt, quote) {
  return {
    id,
    role: 'observation',
    value: {
      type: 'price', amountMinor, currency: 'ARS',
      basis: { type: 'volume', unit: 'L', quantity: 1 }, observedAt,
    },
    evidence: { source, quote },
  };
}

function budgetRequirement(amountMinor) {
  return {
    id: 'budget-1',
    role: 'requirement',
    value: {
      type: 'price', amountMinor, currency: 'ARS',
      basis: { type: 'volume', unit: 'L', quantity: 1 },
    },
    evidence: { quote: `no más de ${amountMinor / 100} ARS por litro` },
  };
}

const observationA = () => priceObservation('obs-A', 180000, 'merchant-A', '2026-10-28T12:00:00.000Z', '1800 ARS/L');
const observationB = () => priceObservation('obs-B', 210000, 'merchant-B', '2026-10-29T12:00:00.000Z', '2100 ARS/L');

test('legacy records preserve absent quantity, unit, and attributes through add/get/put', async () => {
  const added = await Item.add({ listId: 'L', label: 'leche', text: 'leche' });
  const got = await Item.get(added.id);
  assert.equal(Object.hasOwn(got, 'quantity'), false);
  assert.equal(Object.hasOwn(got, 'unit'), false);
  assert.equal(Object.hasOwn(got, 'attributes'), false);
  assert.equal(Object.hasOwn(got, 'sourceAudioId'), false);
  await Item.put({ ...got, done: true });
  const updated = await Item.get(added.id);
  assert.equal(updated.done, true);
  assert.equal(Object.hasOwn(updated, 'attributes'), false);
  assert.equal(Object.hasOwn(updated, 'quantity'), false);
});

test('equal labels retain distinct stable item IDs', async () => {
  const first = await Item.add({ listId: 'L', label: 'leche' });
  const second = await Item.add({ listId: 'L', label: 'leche' });
  assert.notEqual(first.id, second.id);
  assert.equal((await Item.get(first.id)).id, first.id);
  assert.equal((await Item.get(second.id)).id, second.id);
});

test('typed assertion roles and evidence round-trip through add/get/put', async () => {
  const item = await Item.add({
    listId: 'L', label: 'leche',
    attributes: {
      price: [observationA()],
      budget: [{ id: 'need-1', role: 'requirement', value: { type: 'text', value: 'sin lactosa' }, evidence: { quote: 'sin lactosa' } }],
      brand: [{ id: 'pref-1', role: 'preference', value: { type: 'text', value: 'marca local' }, evidence: { quote: 'si hay' } }],
    },
  });
  const got = await Item.get(item.id);
  assert.deepEqual(got.attributes, item.attributes);
  assert.equal(got.attributes.price[0].role, 'observation');
  assert.equal(got.attributes.budget[0].role, 'requirement');
  assert.equal(got.attributes.brand[0].role, 'preference');
  await Item.put({ ...got, done: true });
  assert.deepEqual((await Item.get(item.id)).attributes, item.attributes);
  const legacyShapedUpdate = await Item.put({
    id: item.id, listId: item.listId, label: item.label, text: item.text,
    done: false, createdAt: item.createdAt, order: item.order,
  });
  assert.deepEqual(legacyShapedUpdate.attributes, item.attributes, 'omitting attributes does not implicitly replace the collection');
});

test('duplicate, blank, and reused assertion IDs reject add and put', async () => {
  await assert.rejects(Item.add({
    listId: 'L', label: 'leche', attributes: {
      price: [observationA()], budget: [{ id: 'obs-A', role: 'requirement', value: { type: 'text', value: 'barata' }, evidence: {} }],
    },
  }), /duplicate/i);
  await assert.rejects(Item.add({
    listId: 'L', label: 'leche', attributes: { price: [{ ...observationA(), id: ' ' }] },
  }), /id/i);
  await assert.rejects(Item.add({
    listId: 'L', label: 'leche', attributes: { ' price ': [observationA()] },
  }), /key/i);
  const item = await Item.add({ listId: 'L', label: 'leche', attributes: { price: [observationA()] } });
  await assert.rejects(Item.put({ ...item, attributes: { price: [observationA()], brand: [observationA()] } }), /duplicate/i);
  assert.deepEqual((await Item.get(item.id)).attributes, item.attributes, 'invalid put writes no partial attributes');
  const { observedAt, ...requirementValue } = observationA().value;
  await assert.rejects(Item.put({ ...item, attributes: { price: [{
    ...observationA(), role: 'requirement', value: requirementValue, evidence: { quote: 'budget' },
  }] } }), /immutable/);
  await assert.rejects(Item.put({ ...item, attributes: { price: [observationB()] } }), /removed explicitly/);
});

test('invalid roles, typed values, price basis, source, timestamp, and amount reject', async () => {
  const invalidAssertions = [
    { ...observationA(), role: 'guess' },
    { ...observationA(), value: { ...observationA().value, type: 'text' } },
    { ...observationA(), value: { ...observationA().value, basis: { type: 'currency' } } },
    { ...observationA(), value: { ...observationA().value, basis: { type: 'mass', unit: 'kg', quantity: 0 } } },
    { ...observationA(), value: { ...observationA().value, basis: { type: 'mass', unit: 'L', quantity: 1 } } },
    { ...observationA(), value: { ...observationA().value, basis: { type: 'volume', unit: 'stones', quantity: 1 } } },
    { ...observationA(), value: { ...observationA().value, basis: { type: 'package', unit: 'mystery', quantity: 1 } } },
    { ...observationA(), value: { ...observationA().value, observedAt: 'yesterday' } },
    { ...observationA(), value: { ...observationA().value, observedAt: '2026-02-30T12:00:00Z' } },
    { ...observationA(), evidence: { quote: '1800 pesos' } },
    { ...observationA(), value: { ...observationA().value, amountMinor: 1.5 } },
    { ...observationA(), value: { ...observationA().value, currency: 'USX' } },
  ];
  for (const assertion of invalidAssertions) {
    await assert.rejects(Item.add({ listId: 'L', label: 'leche', attributes: { price: [assertion] } }));
  }
  await assert.rejects(Item.add({
    listId: 'L', label: 'leche', attributes: { price: [{ ...budgetRequirement(1000), role: 'observation' }] },
  }), /observedAt|source/i);
});

test('append requires fresh IDs and replace/remove require existing IDs while preserving role', async () => {
  const item = await Item.add({ listId: 'L', label: 'leche', attributes: { price: [observationA()] } });
  const withSecond = await Item.appendAttribute(item.id, 'price', observationB());
  assert.deepEqual(withSecond.attributes.price.map(({ id }) => id), ['obs-A', 'obs-B']);
  await assert.rejects(Item.appendAttribute(item.id, 'price', observationA()), /duplicate/i);
  await assert.rejects(Item.appendAttribute('missing-item', 'price', observationB()), /not found/i);
  await assert.rejects(Item.replaceAttribute(item.id, 'price', 'missing', { value: observationB().value, evidence: observationB().evidence }), /not found/i);
  await assert.rejects(Item.replaceAttribute(item.id, 'price', 'obs-A', {
    id: 'different-id', value: observationA().value, evidence: observationA().evidence,
  }), /id.*immutable|immutable.*id/i);
  await assert.rejects(Item.replaceAttribute(item.id, 'price', 'obs-A', {
    role: 'requirement', value: observationA().value, evidence: observationA().evidence,
  }), /role.*immutable|immutable.*role/i);
  const replaced = await Item.replaceAttribute(item.id, 'price', 'obs-A', {
    value: { ...observationA().value, amountMinor: 175000 }, evidence: { source: 'merchant-A', quote: '1750 ARS/L' },
  });
  assert.deepEqual(replaced.attributes.price[0], {
    ...observationA(), value: { ...observationA().value, amountMinor: 175000 }, evidence: { source: 'merchant-A', quote: '1750 ARS/L' },
  });
  assert.equal((await Item.removeAttribute(item.id, 'price', 'obs-B')).attributes.price.length, 1);
  await assert.rejects(Item.removeAttribute(item.id, 'price', 'missing'), /not found/i);
  await Item.removeAttribute(item.id, 'price', 'obs-A');
  const changedRole = await Item.appendAttribute(item.id, 'price', {
    id: 'price-need-1', role: 'requirement',
    value: { type: 'price', amountMinor: 170000, currency: 'ARS', basis: { type: 'volume', unit: 'L', quantity: 1 } },
    evidence: { quote: 'presupuesto máximo' },
  });
  assert.equal(changedRole.attributes.price[0].role, 'requirement');
});

test('obs-A, obs-B, and budget-1 round-trip; replacing budget preserves observations', async () => {
  const item = await Item.add({
    listId: 'L', label: 'leche',
    attributes: { price: [observationA(), observationB(), budgetRequirement(200000)] },
  });
  const roundTrip = await Item.get(item.id);
  assert.deepEqual(roundTrip.attributes.price.map(({ id }) => id), ['obs-A', 'obs-B', 'budget-1']);
  const changed = await Item.replaceAttribute(item.id, 'price', 'budget-1', {
    value: { ...budgetRequirement(190000).value }, evidence: { quote: 'máximo 1900 ARS/L' },
  });
  assert.deepEqual(changed.attributes.price.map(({ id }) => id), ['obs-A', 'obs-B', 'budget-1']);
  assert.equal(changed.attributes.price[2].role, 'requirement');
  assert.equal(changed.attributes.price[2].value.amountMinor, 190000);
  assert.deepEqual(changed.attributes.price.slice(0, 2), [observationA(), observationB()]);
  assert.deepEqual((await Item.get(item.id)).attributes.price, changed.attributes.price);
});
