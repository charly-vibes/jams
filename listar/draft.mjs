// Purpose: pure inline-review draft for capture proposals (dictation, pasted lines).
// Responsibilities: build a reviewable draft from a transcript (via the splitter)
//   or from multiline typed text; include/exclude/remove rows; correct row labels
//   while preserving the raw source phrase; count and label the explicit batch
//   confirmation; expand only the edited row; model capture states and the
//   second-capture choice.
// Rationale: A02/A04/A14 require readable rows and exactly one atomic batch with
//   no silent merges; keeping the draft pure makes review deterministic, testable
//   with frozen inputs, and free of storage or DOM side effects.

import { split } from './splitter.js';

// Capture state machine labels (spec: every state change has visible text).
export const CAPTURE_STATES = Object.freeze({
  idle: 'Listo para capturar',
  requesting: 'Pidiendo permiso del micrófono…',
  recording: 'Grabando… toca el botón de nuevo para terminar',
  processing: 'Procesando audio…',
  draft: 'Revisa antes de agregar',
  committing: 'Agregando…',
  failure: 'No se pudo completar la captura',
});

function normalizeProposals(proposals) {
  if (!Array.isArray(proposals)) throw new TypeError('createDraft needs an array of proposals.');
  return proposals.map((proposal, index) => {
    const label = String(proposal?.label ?? '').trim();
    if (!label) throw new TypeError(`Draft proposal ${index} needs a non-empty label.`);
    const row = {
      key: `row-${index}`,
      label,
      text: String(proposal.text ?? label),
      included: proposal.included !== false,
      editing: false,
    };
    if (proposal.quantity !== undefined && proposal.quantity !== null) row.quantity = Number(proposal.quantity);
    if (proposal.unit !== undefined && proposal.unit != null && String(proposal.unit).trim()) row.unit = String(proposal.unit).trim();
    return row;
  });
}

export function createDraft(proposals) {
  return Object.freeze({ rows: Object.freeze(normalizeProposals(proposals).map(Object.freeze)) });
}

/** Dictated transcript → reviewable rows (quantities parsed, duplicates merged by the splitter). */
export function draftFromTranscript(transcript) {
  return createDraft(split(String(transcript ?? '')));
}

/**
 * Multiline typed/pasted text → one reviewable draft. A single line — even with
 * commas — stays literal and returns null so the caller uses direct capture
 * (spec: commas within one typed line are literal).
 */
export function draftFromText(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return null;
  return createDraft(lines.map((line) => ({ label: line, text: line })));
}

function updateRow(draft, index, patch) {
  if (!draft || !Object.hasOwn(draft, 'rows')) throw new TypeError('updateRow needs a draft.');
  if (!Number.isInteger(index) || index < 0 || index >= draft.rows.length) {
    throw new TypeError(`Unknown draft row: ${index}`);
  }
  const rows = draft.rows.map((row, i) => (i === index ? Object.freeze({ ...row, ...patch }) : row));
  return Object.freeze({ rows: Object.freeze(rows) });
}

/** Include/exclude one proposal; exclusion updates the confirmation count. */
export function setRowIncluded(draft, index, included) {
  return updateRow(draft, index, { included: included === true });
}

/** Remove a proposal from this capture permanently (Quitar de esta captura). */
export function removeRow(draft, index) {
  if (!draft || !Object.hasOwn(draft, 'rows')) throw new TypeError('removeRow needs a draft.');
  if (!Number.isInteger(index) || index < 0 || index >= draft.rows.length) {
    throw new TypeError(`Unknown draft row: ${index}`);
  }
  return Object.freeze({ rows: Object.freeze(draft.rows.filter((_, i) => i !== index)) });
}

/** Correct a row label; the raw source phrase (`text`) is never rewritten. */
export function editRowLabel(draft, index, label) {
  return updateRow(draft, index, { label: String(label ?? '') });
}

/** Expand only the chosen row for editing; null collapses every row. */
export function setEditingRow(draft, index) {
  if (index !== null && (!Number.isInteger(index) || index < 0 || index >= draft.rows.length)) {
    throw new TypeError(`Unknown draft row: ${index}`);
  }
  return Object.freeze({
    rows: Object.freeze(draft.rows.map((row, i) => Object.freeze({ ...row, editing: i === index }))),
  });
}

/** Rows that would commit: included with a non-empty (trimmed) label. */
export function confirmableRows(draft) {
  if (!draft || !Object.hasOwn(draft, 'rows')) throw new TypeError('confirmableRows needs a draft.');
  return draft.rows.filter((row) => row.included && String(row.label).trim());
}

export function confirmCount(draft) {
  return confirmableRows(draft).length;
}

/** An all-excluded (or label-less) draft cannot confirm and commits 0 items. */
export function canConfirm(draft) {
  return confirmCount(draft) > 0;
}

export function confirmLabel(draft) {
  return `Agregar ${confirmCount(draft)}`;
}

/** Frozen payload for the one atomic batch commit (A02/A04/A14). */
export function payloadForCommit(draft) {
  return confirmableRows(draft).map((row) => {
    const item = { label: String(row.label).trim(), text: row.text };
    if (row.quantity !== undefined && row.quantity !== null) item.quantity = row.quantity;
    if (row.unit !== undefined) item.unit = row.unit;
    return item;
  });
}

/**
 * Only one active draft: a second capture must choose explicitly between keeping
 * the current review or discarding it — it never silently loses the first.
 */
export function planSecondCapture(activeDraft) {
  if (!activeDraft) return { kind: 'start' };
  return {
    kind: 'choose',
    keep: 'Seguir revisando',
    replace: 'Descartar y reemplazar',
  };
}
