import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWithFallback } from '../analysis-router.mjs';
import { isAppendOnlyExtraction } from '../context-review.mjs';

const context = {
  listId: 'route-list', version: 4, sourceAudioId: 'capture-1',
  items: [{ id: 'rice-1', listId: 'route-list', label: 'arroz', quantity: 1, unit: 'kilo' }],
};

test('no-model route uses deterministic JS analysis and preserves proposal evidence', async () => {
  const result = await analyzeWithFallback('otro kilo de arroz', context);
  assert.equal(result.route, 'deterministic');
  assert.equal(result.analysis.candidates[0].intent, 'increment');
  assert.equal(result.analysis.listId, context.listId);
  assert.equal(result.analysis.version, context.version);
  assert.equal(result.analysis.candidates[0].targetItemIds[0], 'rice-1');
  assert.equal(result.analysis.candidates[0].evidence[0].sourceAudioId, 'capture-1');
});

test('parser failure retains the original transcript and snapshot, then uses deterministic command analysis', async () => {
  const original = structuredClone(context);
  const result = await analyzeWithFallback('sacá arroz', context, {
    parserAttempt: async () => { throw new Error('local parser unavailable'); },
  });
  assert.equal(result.route, 'deterministic-fallback');
  assert.equal(result.failure.message, 'local parser unavailable');
  assert.equal(result.analysis.transcript, 'sacá arroz');
  assert.equal(result.analysis.snapshot.listId, 'route-list');
  assert.equal(result.analysis.snapshot.version, 4);
  assert.deepEqual(context, original);
  assert.equal(result.analysis.candidates[0].intent, 'remove');
  assert.equal(result.analysis.candidates[0].targetItemIds[0], 'rice-1');
  assert.equal(result.analysis.candidates[0].evidence[0].rawText, 'sacá arroz');
});

test('parser failure for unsupported requests returns review and cannot route to implicit append', async () => {
  const result = await analyzeWithFallback('¿cuánta leche queda?', context, {
    parserAttempt: async () => { throw new Error('parser crash'); },
  });
  assert.equal(result.analysis.candidates[0].intent, 'review');
  assert.equal(isAppendOnlyExtraction(result.analysis), false);
  assert.equal(result.analysis.mentions[0].rawText, '¿cuánta leche queda?');
  assert.ok(result.analysis.diagnostics.some(({ code }) => code === 'parser-fallback'));
});

test('an unpromoted parser result is not trusted to bypass contextual analysis', async () => {
  const result = await analyzeWithFallback('agregá leche', context, {
    parserAttempt: async () => ({ label: 'Leche', quantity: 1, unit: 'litro' }),
  });
  assert.equal(result.route, 'deterministic-unpromoted');
  assert.equal(result.analysis.candidates[0].intent, 'add');
  assert.equal(result.analysis.candidates[0].requiresChoice, false);
  assert.ok(result.analysis.diagnostics.some(({ code }) => code === 'parser-output-not-promoted'));
});
