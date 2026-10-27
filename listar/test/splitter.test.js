// splitter.test.js — golden tests for listar/splitter.js (marker + connector + quantity phases)
// Contract under test: split(transcript) → [{ label, text, quantity?, unit? }]
// Spec: listar/spec/functionality.md (§Item Splitter + §Quantity). jams-1i9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { split } from '../splitter.js';

const labels = (t) => split(t).map((i) => i.label);
const q = (t) => split(t)[0];

// ─── Marker phase (jams-3n2) ────────────────────────────────────────────────

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

// ─── Connector phase (jams-asb) ────────────────────────────────────────────

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

test('quantity token after connector is a plausible start', () => {
  // "2 litros de leche" normalizes label to product "leche" (quantity phase)
  const [a, b] = split('pan y 2 litros de leche');
  assert.equal(a.label, 'pan');
  assert.equal(b.label, 'leche');
  assert.equal(b.quantity, 2);
  assert.equal(b.unit, 'litros');
  const [c, d] = split('leche y dos panes');
  assert.equal(c.label, 'leche');
  assert.equal(d.label, 'panes');
  assert.equal(d.quantity, 2);
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

test('NEG: decimal comma does not split connector phase', () => {
  // "1,5" decimal comma must not trigger a connector split; quantity parsing
  // then normalizes to product "arroz" with qty 1.5.
  const items = split('1,5 kilos de arroz');
  assert.equal(items.length, 1);
  assert.equal(items[0].label, 'arroz');
  assert.equal(items[0].quantity, 1.5);
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

// ─── Quantity parsing (jams-1i9) — §Quantity per-segment table (data-driven) ─
// Canonical rule: container/count words (docena, paquete, caja) remain as `unit`
// with their count — never multiplied; physical measures keep the parsed number.

const QTY_TABLE = [
  { name: 'digit + measure unit + "de" + product', input: '2 litros de leche',        exp: { label: 'leche',  quantity: 2,   unit: 'litros' } },
  { name: 'number word "medio" → 0.5',            input: 'medio kilo de tomates',      exp: { label: 'tomates', quantity: 0.5, unit: 'kilo'   } },
  { name: '"por dos" multiplier — no unit',        input: 'leche por dos',             exp: { label: 'leche',  quantity: 2,   unit: undefined } },
  { name: '"x2" multiplier — no unit',            input: 'leche x2',                   exp: { label: 'leche',  quantity: 2,   unit: undefined } },
  { name: '"una docena" container stays as unit',  input: 'una docena de huevos',       exp: { label: 'huevos', quantity: 1,   unit: 'docena' } },
  { name: 'Spanish number words normalized to digits', input: 'dos litros de leche',    exp: { label: 'leche',  quantity: 2,   unit: 'litros' } },
  { name: '"un par de" → 2 (multiplier, no unit)', input: 'un par de panes',           exp: { label: 'panes',  quantity: 2,   unit: undefined } },
  { name: 'de-contraction "del" stripped',        input: '2 kilos del arroz',          exp: { label: 'arroz', quantity: 2,   unit: 'kilos'  } },
  { name: 'unrecognized measure unit (horas) parsed', input: '3 horas de trabajo',    exp: { label: 'trabajo', quantity: 3,  unit: 'horas' } },
];

for (const { name, input, exp } of QTY_TABLE) {
  test(`quantity: ${name}`, () => {
    const item = q(input);
    assert.equal(item.label, exp.label);
    assert.equal(item.quantity, exp.quantity);
    assert.equal(item.unit, exp.unit);
    assert.equal(item.text, input.trim()); // raw phrase preserved on the item
  });
}

test('quantity: items without a quantity keep label===text, no qty/unit', () => {
  for (const item of split('leche')) {
    assert.equal(item.label, item.text);
    assert.equal(item.quantity, undefined);
    assert.equal(item.unit, undefined);
  }
});

test('quantity: dangling quantity (no product) keeps raw phrase as label', () => {
  // "2 kilos de arroz y un litro" → connector splits on "y" →
  // ["2 kilos de arroz", "un litro"]; "un litro" has no product → dangling.
  const items = split('2 kilos de arroz y un litro');
  assert.equal(items.length, 2);
  assert.equal(items[0].label, 'arroz');
  assert.equal(items[0].quantity, 2);
  assert.equal(items[0].unit, 'kilos');
  assert.equal(items[0].text, '2 kilos de arroz');
  assert.equal(items[1].label, 'un litro'); // raw phrase preserved
  assert.equal(items[1].quantity, undefined);
  assert.equal(items[1].unit, undefined);
});

test('quantity: duplicate labels with matching unit merge (sum qty, keep raw text)', () => {
  // "2 litros de leche y 3 litros de leche" → same label+unit → sum.
  const items = split('2 litros de leche y 3 litros de leche');
  assert.equal(items.length, 1);
  assert.equal(items[0].label, 'leche');
  assert.equal(items[0].quantity, 5);
  assert.equal(items[0].unit, 'litros');
  assert.equal(items[0].text, '2 litros de leche'); // raw phrase preserved (not rewritten)
});

test('quantity: duplicate labels with mismatched/missing unit kept separate', () => {
  // "leche x2" (unit undefined) vs "2 litros de leche" (unit litros) → kept.
  const items = split('leche x2 y 2 litros de leche');
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.label), ['leche', 'leche']);
});

test('quantity: non-adjacent duplicates merge across interleaved items', () => {
  // "2 litros de leche y pan y 3 litros de leche" → non-adjacent same label+unit
  // must still merge (merge window, not adjacency-only).
  const items = split('2 litros de leche y pan y 3 litros de leche');
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.label), ['leche', 'pan']);
  assert.equal(items[0].quantity, 5);
});
