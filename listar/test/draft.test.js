// Purpose: verify the pure inline-review draft for capture proposals.
// Responsibilities: cover transcript/text draft building, row exclusion and
//   correction, confirmation counting/labeling, editing expansion, the
//   second-capture choice and visible capture-state text.
// Rationale: A02/A04 require reviewable rows and exactly one explicit batch;
//   the draft is pure so persistence-free review is deterministic and frozen
//   inputs prove zero mutation.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTURE_STATES,
  createDraft,
  draftFromText,
  draftFromTranscript,
  setRowIncluded,
  removeRow,
  editRowLabel,
  setEditingRow,
  confirmCount,
  canConfirm,
  confirmLabel,
  payloadForCommit,
  planSecondCapture,
} from '../draft.mjs';

const STATES = ['idle', 'requesting', 'recording', 'processing', 'draft', 'committing', 'failure'];

test('A02: three-item dictation becomes three readable rows with one Agregar 3 confirmation', () => {
  const transcript = 'leche, pan y huevos';
  const draft = draftFromTranscript(transcript);
  assert.equal(transcript, 'leche, pan y huevos', 'input transcript stays untouched');
  assert.deepEqual(draft.rows.map((row) => row.label), ['leche', 'pan', 'huevos']);
  assert.ok(draft.rows.every((row) => row.included === true));
  assert.equal(confirmCount(draft), 3);
  assert.equal(confirmLabel(draft), 'Agregar 3');
  assert.equal(canConfirm(draft), true);
});

test('A04: excluding one row and correcting another leaves exactly two intended proposals', () => {
  const draft = draftFromTranscript('leche, pan y huevos');
  const excluded = setRowIncluded(draft, 1, false);
  const corrected = editRowLabel(excluded, 0, 'leche deslactosada');
  assert.equal(confirmCount(corrected), 2);
  assert.equal(confirmLabel(corrected), 'Agregar 2');
  const payload = payloadForCommit(corrected);
  assert.deepEqual(payload, [
    { label: 'leche deslactosada', text: 'leche' },
    { label: 'huevos', text: 'huevos' },
  ], 'corrected label is saved and raw source text is preserved; no merge with existing items');
  assert.deepEqual(draft.rows.map((row) => row.label), ['leche', 'pan', 'huevos'], 'original draft is not mutated');
});

test('multiline typed or pasted input becomes a draft; single-line comma text stays literal', () => {
  const multiline = 'leche\npan\n\nhuevos';
  const draft = draftFromText(multiline);
  assert.deepEqual(draft.rows.map((row) => row.label), ['leche', 'pan', 'huevos']);
  assert.equal(confirmCount(draft), 3);
  assert.equal(draftFromText('leche, pan y huevos'), null, 'commas in one typed line remain literal');
  assert.equal(draftFromText('  pan  '), null, 'a single line stays a direct literal capture');
  assert.equal(draftFromText(''), null);
  assert.equal(draftFromText('\n \n'), null);
});

test('all-excluded draft disables confirmation and commits zero items', () => {
  let draft = draftFromTranscript('leche, pan y huevos');
  draft = setRowIncluded(draft, 0, false);
  draft = setRowIncluded(draft, 1, false);
  draft = setRowIncluded(draft, 2, false);
  assert.equal(canConfirm(draft), false);
  assert.equal(confirmCount(draft), 0);
  assert.deepEqual(payloadForCommit(draft), []);
});

test('Quitar de esta captura removes a row permanently and updates the count', () => {
  const draft = removeRow(draftFromTranscript('leche, pan y huevos'), 1);
  assert.deepEqual(draft.rows.map((row) => row.label), ['leche', 'huevos']);
  assert.equal(confirmLabel(draft), 'Agregar 2');
});

test('dictated quantities read on the row and only the edited row expands', () => {
  const draft = draftFromTranscript('2 litros de leche y pan');
  assert.equal(draft.rows[0].quantity, 2);
  assert.equal(draft.rows[0].unit, 'litros');
  assert.equal(draft.rows[1].quantity, undefined);
  const editing = setEditingRow(draft, 1);
  assert.equal(editing.rows[0].editing, false);
  assert.equal(editing.rows[1].editing, true, 'only the chosen row expands');
  const collapsed = setEditingRow(editing, null);
  assert.ok(collapsed.rows.every((row) => row.editing === false));
});

test('a second capture never silently overwrites the active draft', () => {
  assert.deepEqual(planSecondCapture(null), { kind: 'start' });
  const active = createDraft([{ label: 'leche', text: 'leche' }]);
  const plan = planSecondCapture(active);
  assert.equal(plan.kind, 'choose');
  assert.equal(plan.keep, 'Seguir revisando');
  assert.equal(plan.replace, 'Descartar y reemplazar');
});

test('every capture state has visible Spanish text', () => {
  for (const state of STATES) {
    assert.equal(typeof CAPTURE_STATES[state], 'string');
    assert.ok(CAPTURE_STATES[state].trim().length > 3, `${state} needs readable text`);
  }
  assert.deepEqual(Object.keys(CAPTURE_STATES), STATES);
});
