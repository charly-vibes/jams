import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPartitions, validatePartitions, evaluateHeldOut, reportMarkdown } from '../eval/evaluate.mjs';

test('evaluation partitions are disjoint and explicitly separate synthetic from real dictations', async () => {
  const partitions = await loadPartitions();
  assert.equal(validatePartitions(partitions), true);
  for (const partition of Object.values(partitions)) {
    assert.ok(partition.every(({ provenance }) => provenance === 'constructed-spec-fixture'));
  }
  assert.ok(partitions.train.length > 0);
  assert.ok(partitions.dev.length > 0);
  assert.ok(partitions.heldout.length >= 10);
});

test('the evaluator measures only held-out deterministic JS cases and discloses unavailable human/model measures', async () => {
  const partitions = await loadPartitions();
  const report = await evaluateHeldOut(partitions.heldout);
  assert.equal(report.baseline, 'deterministic JavaScript analyzer');
  assert.equal(report.evaluatedSplit, 'held-out');
  assert.equal(report.metrics.caseCount, partitions.heldout.length);
  assert.equal(report.metrics.modelDownloadBytes, null);
  assert.equal(report.metrics.realDictationCount, 0);
  assert.equal(report.metrics.humanCorrectionEffort, 'not measured');
  assert.equal(report.metrics.parserFailureFixtures, 1);
  assert.equal(report.metrics.quantityAccuracy, 1);
  assert.equal(report.metrics.unitAccuracy, 1);
  assert.ok(report.metrics.sourceAlignmentRate >= 0 && report.metrics.sourceAlignmentRate <= 1);
  assert.ok(report.metrics.unsafeRouteCount >= 0);
  assert.equal(report.metrics.confidenceCalibration, 'not measured; outputs are not probabilities');
  assert.ok(report.caseResults.every(({ split }) => split === 'held-out'));
  assert.equal(report.caseResults.find(({ id }) => id === 'heldout-parser-failure-falls-back-to-review').route, 'deterministic-fallback');
  assert.ok(report.caseResults.some(({ id, evidenceAligned }) => id === 'heldout-audio-evidence-preserved' && evidenceAligned));
  assert.match(reportMarkdown(report), /not measured; outputs are not probabilities/u);
  assert.match(reportMarkdown(report), /not blinded and not transcribed speech/u);
});

test('overlapping utterance text across train, dev, and held-out partitions is rejected', () => {
  const fixture = { id: 'same', text: 'agregá leche', provenance: 'constructed-spec-fixture', expected: { intents: ['add'] } };
  assert.throws(() => validatePartitions({
    train: [fixture], dev: [], heldout: [{ ...fixture, id: 'different-id' }],
  }), /overlap/i);
});
