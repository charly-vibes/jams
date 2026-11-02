// Purpose: pin the pure one-question-at-a-time resolution of dictated voice changes.
// Responsibilities: freeze workspace snapshots and exercise scope, question steps,
//   answers, exclusions and the non-destructive action plan for A05/A06.
// Rationale: interpretation must never guess a target, never emit destructive
//   removal and never persist; fixtures define the contract before implementation.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeVoiceTranscript, answerStep, createVoiceSession, excludeCandidate,
  isSessionStale, scopeItems, sessionActions, sessionStep, actionSummaries,
} from '../voice-resolution.mjs';

function workspace(overrides = {}) {
  return structuredClone({
    revision: 7,
    collections: [
      { id: 'col-compras', name: 'Compras', emoji: '🛒', order: 1 },
      { id: 'col-farmacia', name: 'Farmacia', emoji: '', order: 2 },
    ],
    items: [
      { id: 'milk-a', label: 'Leche', text: 'leche', quantity: 2, unit: 'litros', done: false, collectionId: 'col-compras', createdAt: 1 },
      { id: 'milk-b', label: 'Leche', text: 'leche deslactosada', quantity: 1, unit: 'litro', done: false, collectionId: 'col-farmacia', createdAt: 2 },
      { id: 'bread', label: 'Pan', text: 'pan', done: false, collectionId: null, createdAt: 3 },
      { id: 'old-milk', label: 'Leche', text: 'leche vieja', done: false, archived: true, collectionId: 'col-compras', createdAt: 0 },
    ],
    ...overrides,
  });
}

test('R7 scope: global commands resolve against all scoped non-archived items, not only visible rows', () => {
  const snapshot = workspace();
  const scoped = scopeItems(snapshot, null);
  assert.deepEqual(scoped.map(({ id }) => id).sort(), ['bread', 'milk-a', 'milk-b']);
  const inCompras = scopeItems(snapshot, 'col-compras');
  assert.deepEqual(inCompras.map(({ id }) => id), ['milk-a']);
  const voice = analyzeVoiceTranscript('sacá la leche', snapshot, { collectionId: null });
  assert.equal(voice.commandLike, true);
  assert.deepEqual(voice.candidates[0].targetItemIds.sort(), ['milk-a', 'milk-b']);
});

test('R1 A06: duplicate targets ask one plain-language target question with readable choices, never raw IDs', () => {
  const snapshot = workspace();
  const voice = analyzeVoiceTranscript('sacá la leche', snapshot);
  const session = createVoiceSession(voice, { operationId: 'op-r1', now: 1000 });
  assert.equal(sessionActions(session).ok, false, 'unresolved session cannot commit');
  const step = sessionStep(session);
  assert.equal(step.kind, 'target');
  assert.match(step.question, /leche/i);
  assert.equal(step.choices.length, 2);
  const texts = step.choices.map(({ text }) => text).join('\n');
  assert.match(texts, /Compras/);
  assert.match(texts, /Farmacia/);
  assert.match(texts, /2 litros/);
  assert.doesNotMatch(texts, /milk-a|milk-b/);
  // Borrado entra por el mismo camino de resolución.
  const borrar = sessionStep(createVoiceSession(analyzeVoiceTranscript('borrá la leche', snapshot)));
  assert.equal(borrar.kind, 'target');
});

test('R1 A06: after the target answer, one disposition question offers archive or detach; no execution before both', () => {
  const snapshot = workspace();
  const session = createVoiceSession(analyzeVoiceTranscript('sacá la leche', snapshot), { operationId: 'op-r1b' });
  const target = sessionStep(session);
  const answered = answerStep(session, target, 'milk-a');
  const planBefore = sessionActions(answered);
  assert.equal(planBefore.ok, false, 'disposition still pending blocks the batch');
  const disposition = sessionStep(answered);
  assert.equal(disposition.kind, 'disposition');
  assert.equal(disposition.question, '¿Archivar o quitar de la lista?');
  assert.deepEqual(disposition.choices.map(({ value }) => value), ['archive', 'detach']);
  assert.match(disposition.choices.find(({ value }) => value === 'detach').text, /Compras/);
  const archived = answerStep(answered, disposition, 'archive');
  const plan = sessionActions(archived);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.actions, [{ kind: 'archive', itemId: 'milk-a' }]);
  const detached = answerStep(answered, disposition, 'detach');
  assert.deepEqual(sessionActions(detached).actions, [{ kind: 'detach', itemId: 'milk-a', fromCollectionId: 'col-compras' }]);
});

test('R2 A06: an unassigned target explains only archive is available, still requiring confirmation', () => {
  const snapshot = workspace({ items: workspace().items.filter(({ id }) => id === 'bread' || id === 'old-milk') });
  const withBread = { ...snapshot, items: [...snapshot.items, { id: 'solo-pan', label: 'Leche', text: 'leche suelta', done: false, collectionId: null, createdAt: 9 }] };
  const session = createVoiceSession(analyzeVoiceTranscript('sacá la leche', withBread), { operationId: 'op-r2' });
  const step = sessionStep(session);
  assert.equal(step.kind, 'disposition');
  assert.deepEqual(step.choices.map(({ value }) => value), ['archive']);
  assert.match(step.detail, /no está en ninguna lista/);
  assert.equal(sessionActions(session).ok, false);
});

test('R5: voice resolution never emits the legacy destructive remove intent', () => {
  const snapshot = workspace();
  let session = createVoiceSession(analyzeVoiceTranscript('sacá la leche', snapshot), { operationId: 'op-r5' });
  let step = sessionStep(session);
  while (step) {
    session = answerStep(session, step, step.kind === 'target' ? 'milk-a' : 'archive');
    step = sessionStep(session);
  }
  const { actions } = sessionActions(session);
  assert.ok(actions.length > 0);
  for (const action of actions) {
    assert.notEqual(action.kind, 'remove');
    assert.notEqual(action.kind, 'delete');
  }
});

test('R3 A05/A06: cancelling an answered session writes nothing and keeps the snapshot immutable', () => {
  const snapshot = workspace();
  const frozen = structuredClone(snapshot);
  let session = createVoiceSession(analyzeVoiceTranscript('sacá la leche', snapshot), { operationId: 'op-r3' });
  let step = sessionStep(session);
  while (step) {
    session = answerStep(session, step, step.kind === 'target' ? 'milk-a' : 'archive');
    step = sessionStep(session);
  }
  // The pure session carries no persistence authority: discarding it changes nothing.
  session = null;
  assert.deepEqual(snapshot, frozen);
});

test('R4 A05: a speech repair asks one plain-language choice and blocks execution until resolved', () => {
  const snapshot = workspace();
  const voice = analyzeVoiceTranscript('leche no yogur', snapshot);
  assert.equal(voice.commandLike, true);
  const session = createVoiceSession(voice, { operationId: 'op-r4', now: 500 });
  assert.equal(sessionActions(session).ok, false);
  const step = sessionStep(session);
  assert.equal(step.kind, 'repair');
  assert.match(step.question, /qué querías decir/i);
  assert.deepEqual(step.choices.map(({ text }) => text), ['Agregar Leche', 'Agregar Yogur']);
  const resolved = answerStep(session, step, 'replace-first');
  const plan = sessionActions(resolved);
  assert.equal(plan.ok, true);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].kind, 'add');
  assert.equal(plan.actions[0].item.label, 'Yogur');
  assert.equal(plan.actions[0].item.text, 'leche no yogur', 'raw source phrase is preserved');
  assert.equal(plan.actions[0].collectionId, null);
});

test('R4 A05: excluding an unresolvable proposal updates the batch instead of adding it', () => {
  const snapshot = workspace();
  const session = createVoiceSession(analyzeVoiceTranscript('sacá la leche y ordená la lista', snapshot), { operationId: 'op-r4b' });
  let step = sessionStep(session);
  assert.equal(step.kind, 'target');
  let current = answerStep(session, step, 'milk-a');
  step = sessionStep(current);
  assert.equal(step.kind, 'disposition');
  current = answerStep(current, step, 'archive');
  step = sessionStep(current);
  assert.equal(step.kind, 'blocked');
  assert.match(step.question, /no se pudo resolver/i);
  assert.deepEqual(step.choices.map(({ value }) => value), ['exclude']);
  current = excludeCandidate(current, step.candidateIndex);
  const plan = sessionActions(current);
  assert.equal(plan.ok, true);
  assert.equal(plan.actions.length, 1, 'excluded proposal neither blocks nor appends');
});

test('R6: identical labels with no distinguishing facts get stable local aliases', () => {
  const items = [1, 2].map((n) => ({
    id: `twin-${n}`, label: 'Leche', text: `leche ${n}`, done: false, collectionId: null, createdAt: n,
  }));
  const snapshot = workspace({ items });
  const session = createVoiceSession(analyzeVoiceTranscript('sacá la leche', snapshot), { operationId: 'op-r6' });
  const step = sessionStep(session);
  assert.equal(step.kind, 'target');
  assert.deepEqual(step.choices.map(({ text }) => text), ['Leche · entrada 1', 'Leche · entrada 2']);
});

test('scope label and stale detection support A18 fresh review', () => {
  const snapshot = workspace();
  const scoped = analyzeVoiceTranscript('sacá la leche', snapshot, { collectionId: 'col-compras' });
  assert.equal(scoped.scope.label, 'Compras');
  const global = analyzeVoiceTranscript('sacá la leche', snapshot);
  assert.equal(global.scope.label, 'todas tus listas');
  const session = createVoiceSession(global, { operationId: 'op-r7' });
  assert.equal(isSessionStale(session, snapshot), false);
  assert.equal(isSessionStale(session, { ...snapshot, revision: 8 }), true);
});

test('repeat additions ask one choice and resolve to a distinct add or an increment', () => {
  const single = workspace({ items: workspace().items.filter(({ id }) => id === 'milk-a') });
  const one = createVoiceSession(analyzeVoiceTranscript('agregá leche', single), { operationId: 'op-r8' });
  const step = sessionStep(one);
  assert.equal(step.kind, 'repeat-add');
  const distinct = answerStep(one, step, 'add-distinct');
  const distinctPlan = sessionActions(distinct);
  assert.equal(distinctPlan.ok, true);
  assert.equal(distinctPlan.actions[0].kind, 'add');
  assert.equal(distinctPlan.actions[0].item.label, 'Leche');
  const increased = answerStep(one, step, 'increment-existing');
  const incrementPlan = sessionActions(increased);
  assert.equal(incrementPlan.ok, true);
  assert.equal(incrementPlan.actions[0].kind, 'increment');
  assert.equal(incrementPlan.actions[0].itemId, 'milk-a');
  // Incrementing with several matches still asks which entry; it never guesses.
  const many = createVoiceSession(analyzeVoiceTranscript('agregá leche', workspace()), { operationId: 'op-r8b' });
  const chosen = answerStep(many, sessionStep(many), 'increment-existing');
  assert.equal(sessionStep(chosen).kind, 'target');
  assert.equal(sessionActions(chosen).ok, false);
});

test('action summaries read as concrete change descriptions in Spanish', () => {
  const snapshot = workspace();
  const summaries = actionSummaries([
    { kind: 'archive', itemId: 'milk-a' },
    { kind: 'detach', itemId: 'milk-b', fromCollectionId: 'col-farmacia' },
    { kind: 'add', item: { label: 'Yogur', quantity: 2, unit: 'unidades' }, collectionId: null },
  ], snapshot);
  assert.deepEqual(summaries, [
    'Archivar Leche',
    'Quitar de Farmacia; conservar en Sin lista',
    'Agregar Yogur · 2 unidades',
  ]);
});
