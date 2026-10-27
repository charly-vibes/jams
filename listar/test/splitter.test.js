// splitter.test.js — golden tests for listar/splitter.js (marker phase, jams-3n2)
// Contract under test: split(transcript) → [{ label, text }]  (quantity?/unit? arrive in jams-1i9)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { split } from '../splitter.js';

const labels = (t) => split(t).map((i) => i.label);

test('numbered markers with dots: "1." each become items', () => {
  assert.deepEqual(labels('1. leche\n2. pan\n3. té'), ['leche', 'pan', 'té']);
});

test('numbered markers with paren: "1)"', () => {
  assert.deepEqual(labels('1) leche\n2) pan'), ['leche', 'pan']);
});

test('Spanish ordinal marker "uno)"', () => {
  assert.deepEqual(labels('uno) leche\ndos) pan'), ['leche', 'pan']);
});

test('dash bullets', () => {
  assert.deepEqual(labels('- leche\n- pan\n- té'), ['leche', 'pan', 'té']);
});

test('bullet dot "•" and asterisk "*"', () => {
  assert.deepEqual(labels('• leche\n* pan'), ['leche', 'pan']);
});

test('plain line breaks split into items', () => {
  assert.deepEqual(labels('leche\npan\nté'), ['leche', 'pan', 'té']);
});

test('mixed markers: numbers, bullets and bare lines coexist', () => {
  assert.deepEqual(labels('1. leche\n- pan\nhuevos\n2) té'), ['leche', 'pan', 'huevos', 'té']);
});

test('inline markers on a single line split too', () => {
  assert.deepEqual(labels('1. leche 2. pan 3. té'), ['leche', 'pan', 'té']);
});

test('no markers, single line → fallback: whole transcript is one item', () => {
  const items = split('comprar leche y pan en el super');
  assert.equal(items.length, 1);
  assert.equal(items[0].label, 'comprar leche y pan en el super');
});

test('items carry raw text equal to label at this phase', () => {
  for (const item of split('1. leche\n2. pan')) {
    assert.equal(item.text, item.label);
  }
});

test('markers are stripped but inner text is preserved verbatim', () => {
  assert.deepEqual(labels('1. café con leche\n- pan de molde'), ['café con leche', 'pan de molde']);
});

test('marker-only line yields no empty item', () => {
  assert.deepEqual(labels('1.\n2. pan\n-'), ['pan']);
});

test('empty and whitespace-only input → no items', () => {
  assert.deepEqual(split(''), []);
  assert.deepEqual(split('   \n  \n'), []);
});
