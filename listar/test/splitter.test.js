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

test('no markers/connectors, single line → fallback: whole transcript is one item', () => {
  const items = split('comprar leche en el super');
  assert.equal(items.length, 1);
  assert.equal(items[0].label, 'comprar leche en el super');
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

// ─── Connector phase (jams-asb) ───

test('comma splits marker-free segments', () => {
  assert.deepEqual(labels('leche, pan, té'), ['leche', 'pan', 'té']);
});

test('"y" splits when followed by a product', () => {
  assert.deepEqual(labels('leche y pan'), ['leche', 'pan']);
});

test('"e" copulative splits', () => {
  assert.deepEqual(labels('sal e hinojo'), ['sal', 'hinojo']);
});

test('adverb connectors: luego / además', () => {
  assert.deepEqual(labels('comprar leche luego fruta'), ['comprar leche', 'fruta']);
  assert.deepEqual(labels('leche además pan'), ['leche', 'pan']);
});

test('"y también" compound splits once', () => {
  assert.deepEqual(labels('leche y también pan'), ['leche', 'pan']);
});

test('determiner after connector is a plausible start', () => {
  assert.deepEqual(labels('leche y el pan'), ['leche', 'el pan']);
});

test('quantity token after connector is a plausible start (no qty parsing yet)', () => {
  assert.deepEqual(labels('pan y 2 litros de leche'), ['pan', '2 litros de leche']);
  assert.deepEqual(labels('leche y dos panes'), ['leche', 'dos panes']);
});

test('NEG: "con" is not a connector', () => {
  assert.deepEqual(labels('café con leche'), ['café con leche']);
});

test('NEG: "de" is not a connector', () => {
  assert.deepEqual(labels('pan de molde'), ['pan de molde']);
});

test('NEG: "después" followed by non-start does not split', () => {
  assert.deepEqual(labels('lavar después de comer'), ['lavar después de comer']);
});

test('NEG: decimal comma does not split', () => {
  assert.deepEqual(labels('1,5 kilos de arroz'), ['1,5 kilos de arroz']);
});

test('NEG: short stopword after "y" does not split', () => {
  assert.deepEqual(labels('tú y yo vamos al mercado'), ['tú y yo vamos al mercado']);
});

test('connectors apply inside marker segments too', () => {
  assert.deepEqual(labels('1. leche, pan\n2. jabón'), ['leche', 'pan', 'jabón']);
});

test('inline markers: trailing connector on a segment is cleaned up', () => {
  assert.deepEqual(labels('1. leche 2. pan y 3. té'), ['leche', 'pan', 'té']);
});
