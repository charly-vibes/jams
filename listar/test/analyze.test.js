import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../analyze.mjs';
import { split } from '../splitter.js';

const context = {
  listId: 'list-1', version: 7, audioId: 'audio-9',
  items: [
    { id: 'milk-1', label: 'leche', quantity: 1, unit: 'litro' },
    { id: 'milk-2', label: 'leche', quantity: 2, unit: 'litros' },
  ],
};

test('analyze distinguishes increment, set, add, and query without changing the snapshot', () => {
  const original = structuredClone(context);
  const increment = analyze('otro litro de leche', context).candidates[0];
  const set = analyze('poné dos litros de leche', context).candidates[0];
  const add = analyze('agregá leche', context).candidates[0];
  const query = analyze('¿ya hay leche?', context).candidates[0];
  assert.equal(increment.intent, 'increment');
  assert.deepEqual(increment.targetItemIds, ['milk-1', 'milk-2']);
  assert.equal(set.intent, 'set');
  assert.equal(set.proposed.quantity, 2);
  assert.equal(add.intent, 'add');
  assert.equal(add.requiresChoice, true);
  assert.equal(query.intent, 'query');
  assert.equal(query.stateIdentity, true);
  assert.deepEqual(context, original);
});

test('analysis retains every source mention, exact spans, raw phrase, and audio reference across duplicate labels', () => {
  const transcript = 'agregá leche y agregá leche';
  const result = analyze(transcript, { ...context, items: [{ id: 'milk-1', label: 'leche' }] });
  assert.equal(result.listId, 'list-1');
  assert.equal(result.version, 7);
  assert.equal(result.mentions.length, 2);
  assert.deepEqual(result.mentions.map((mention) => transcript.slice(mention.start, mention.end)), result.mentions.map((mention) => mention.rawText));
  assert.deepEqual(result.mentions.map(({ rawText }) => rawText), ['agregá leche', 'agregá leche']);
  assert.ok(result.mentions.every(({ audioId, sourceAudioId }) => audioId === 'audio-9' && sourceAudioId === 'audio-9'));
  assert.ok(result.candidates.every(({ evidence }) => evidence[0].audioId === 'audio-9' && evidence[0].sourceAudioId === 'audio-9'));
});

test('price observation and budget requirement remain different typed intents with source evidence', () => {
  const observed = analyze('la leche sale 2000 pesos por litro', context).candidates[0];
  const budget = analyze('no más de 2000 pesos por litro para la leche', context).candidates[0];
  assert.equal(observed.intent, 'update-attribute');
  assert.equal(observed.assertion.role, 'observation');
  assert.equal(observed.assertion.value.amountMinor, 200000);
  assert.equal(budget.intent, 'update-attribute');
  assert.equal(budget.assertion.role, 'requirement');
  assert.equal(budget.assertion.value.amountMinor, 200000);
  assert.equal(observed.assertion.evidence.rawText, 'la leche sale 2000 pesos por litro');
});

test('repair ambiguity is retained instead of treating both sides as adds', () => {
  const result = analyze('leche no yogur', context);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].intent, 'ambiguous');
  assert.deepEqual(result.candidates[0].alternatives.map(({ label }) => label), ['leche', 'yogur']);
  assert.ok(result.diagnostics.some(({ code }) => code === 'speech-repair-ambiguous'));
});

test('removal with equal labels targets both stable IDs as unresolved alternatives', () => {
  const candidate = analyze('sacá la leche', context).candidates[0];
  assert.equal(candidate.intent, 'remove');
  assert.deepEqual(candidate.targetItemIds, ['milk-1', 'milk-2']);
  assert.equal(candidate.requiresChoice, true);
});

test('empty transcript is safe and split compatibility remains unchanged', () => {
  assert.deepEqual(analyze('  \n ', context).candidates, []);
  const transcript = '2 litros de leche y 3 litros de leche';
  assert.deepEqual(analyze(transcript, context).legacyItems, split(transcript));
});

test('missing or malformed snapshot preserves inputs and routes proposals to review', () => {
  const source = 'sacá la leche';
  const result = analyze(source, { listId: 'list-1', version: 'stale', items: [{ id: 'milk-1', label: 'leche' }] });
  assert.equal(result.transcript, source);
  assert.deepEqual(result.snapshot.items, [{ id: 'milk-1', label: 'leche' }]);
  assert.equal(result.candidates[0].intent, 'review');
  assert.deepEqual(result.candidates[0].targetItemIds, []);
  assert.ok(result.diagnostics.some(({ code }) => code === 'snapshot-required'));
});

test('decimal comma stays inside the exact source mention and parses as a decimal quantity', () => {
  const transcript = 'poné 1,5 litros de leche';
  const result = analyze(transcript, context);
  assert.equal(result.mentions.length, 1);
  assert.equal(result.mentions[0].rawText, transcript);
  assert.deepEqual([result.mentions[0].start, result.mentions[0].end], [0, transcript.length]);
  assert.equal(result.candidates[0].intent, 'set');
  assert.equal(result.candidates[0].proposed.quantity, 1.5);
});

test('explicit add preserves parsed quantity and unit in its proposal', () => {
  const candidate = analyze('agregá dos litros de leche', context).candidates[0];
  assert.equal(candidate.intent, 'add');
  assert.equal(candidate.label, 'leche');
  assert.deepEqual(candidate.proposed, { quantity: 2, unit: 'litros' });
});

test('context item matching never targets a record from another list', () => {
  const candidate = analyze('sacá la leche', {
    ...context,
    items: [
      { id: 'milk-other-list', listId: 'list-2', label: 'leche' },
      { id: 'milk-current-list', listId: 'list-1', label: 'leche' },
    ],
  }).candidates[0];
  assert.deepEqual(candidate.targetItemIds, ['milk-current-list']);
  assert.deepEqual(candidate.alternatives, [{ itemId: 'milk-current-list', label: 'leche' }]);
});
