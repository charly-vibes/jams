// Purpose: evaluate the deterministic contextual analyzer on a held-out contract fixture partition.
// Responsibilities: validate data separation, report route/evidence metrics, and emit reproducible local artifacts.
// Rationale: model escalation must be justified by measured failures, with synthetic data clearly separated from speech.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { analyze } from '../analyze.mjs';
import { analyzeWithFallback } from '../analysis-router.mjs';
import { isAppendOnlyExtraction } from '../context-review.mjs';

const fixtureDir = new URL('./fixtures/', import.meta.url);
const reportDir = new URL('./reports/', import.meta.url);

export async function loadPartitions() {
  const entries = await Promise.all(['train', 'dev', 'held-out'].map(async (name) => {
    const text = await readFile(new URL(`${name}.json`, fixtureDir), 'utf8');
    return [name === 'held-out' ? 'heldout' : name, JSON.parse(text)];
  }));
  return Object.fromEntries(entries);
}

/** Validate fixture identity and utterance separation without evaluating train/dev examples. */
export function validatePartitions(partitions) {
  const names = ['train', 'dev', 'heldout'];
  const ids = new Set();
  const texts = new Set();
  for (const name of names) {
    if (!Array.isArray(partitions?.[name])) throw new TypeError(`Missing fixture partition: ${name}`);
    for (const fixture of partitions[name]) {
      if (!fixture || typeof fixture.id !== 'string' || typeof fixture.text !== 'string' || !fixture.text.trim()) {
        throw new TypeError(`${name} fixtures need an ID and non-empty utterance`);
      }
      if (fixture.provenance !== 'constructed-spec-fixture') {
        throw new TypeError(`${fixture.id} needs explicit constructed fixture provenance`);
      }
      if (ids.has(fixture.id)) throw new Error(`Fixture ID overlap: ${fixture.id}`);
      ids.add(fixture.id);
      const key = fixture.text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/gu, ' ').trim();
      if (texts.has(key)) throw new Error(`Utterance overlap across partitions: ${fixture.text}`);
      texts.add(key);
      if (!Array.isArray(fixture.expected?.intents)) throw new TypeError(`${fixture.id} needs labeled expected intents`);
    }
  }
  return true;
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function candidateIsActionable(candidate) {
  return ['add', 'increment', 'set', 'remove', 'update-attribute'].includes(candidate.intent) && !candidate.requiresChoice;
}

function alignedEvidence(analysis, transcript, expectedAudioId) {
  if (analysis.mentions.length !== analysis.candidates.length) return false;
  const spansGood = analysis.mentions.every(({ rawText, start, end }) =>
    Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && transcript.slice(start, end) === rawText);
  const evidenceGood = analysis.candidates.every((candidate, index) => {
    const evidence = candidate.evidence ?? [];
    return evidence.length === 1 && evidence[0].rawText === analysis.mentions[index].rawText &&
      evidence[0].start === analysis.mentions[index].start && evidence[0].end === analysis.mentions[index].end &&
      (expectedAudioId == null || (evidence[0].sourceAudioId === expectedAudioId && analysis.mentions[index].sourceAudioId === expectedAudioId));
  });
  return spansGood && evidenceGood;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

function emptyIntentMetrics() {
  return { cases: 0, correct: 0, accuracy: null, proposals: 0, review: 0, actionable: 0, proposalCoverage: null, safeActionCoverage: null, reviewRate: null };
}

/** Evaluate only the held-out partition; no persistence or model execution occurs here. */
export async function evaluateHeldOut(fixtures) {
  if (!Array.isArray(fixtures)) throw new TypeError('Held-out fixtures must be an array');
  const caseResults = [];
  const latencies = [];
  const perIntent = {};
  let candidateCount = 0;
  let correctIntentCount = 0;
  let targetCount = 0;
  let targetCorrect = 0;
  let choiceCount = 0;
  let choiceCorrect = 0;
  let quantityCount = 0;
  let quantityCorrect = 0;
  let unitCount = 0;
  let unitCorrect = 0;
  let priceRoleCount = 0;
  let priceRoleCorrect = 0;
  let appendOnlyCount = 0;
  let appendOnlyCorrect = 0;
  let reviewCount = 0;
  let resolutionProxyCount = 0;
  let alignedCandidateCount = 0;
  let unsafeRouteCount = 0;
  let actionableCount = 0;

  for (const fixture of fixtures) {
    const started = performance.now();
    const routed = fixture.parserFailure
      ? await analyzeWithFallback(fixture.text, fixture.context ?? {}, {
        parserAttempt: async () => { throw new Error('constructed parser failure'); },
      })
      : { route: 'deterministic', analysis: analyze(fixture.text, fixture.context ?? {}) };
    const analysis = routed.analysis;
    const latencyMs = performance.now() - started;
    latencies.push(latencyMs);
    const candidates = analysis.candidates;
    const expected = fixture.expected;
    const predictedIntents = candidates.map(({ intent }) => intent);
    const caseIntentCorrect = sameArray(predictedIntents, expected.intents);
    const intentCorrect = candidates.map((candidate, index) => candidate.intent === expected.intents[index]);
    const predictedTargets = candidates.map(({ targetItemIds }) => [...targetItemIds].sort());
    const targetCorrectAt = candidates.map((_, index) => expected.targetIds == null || sameArray(predictedTargets[index] ?? [], [...(expected.targetIds[index] ?? [])].sort()));
    const caseTargetCorrect = targetCorrectAt.every(Boolean) && candidates.length === (expected.targetIds?.length ?? candidates.length);
    const predictedChoices = candidates.map(({ requiresChoice }) => Boolean(requiresChoice));
    const choiceCorrectAt = candidates.map((candidate, index) => expected.requiresChoice == null || Boolean(candidate.requiresChoice) === Boolean(expected.requiresChoice[index]));
    const caseChoiceCorrect = choiceCorrectAt.every(Boolean) && candidates.length === (expected.requiresChoice?.length ?? candidates.length);
    const priceRoles = candidates.map(({ assertion }) => assertion?.role ?? null);
    const casePriceRoleCorrect = expected.priceRoles == null || sameArray(priceRoles, expected.priceRoles);
    const predictedQuantities = candidates.map(({ proposed }) => proposed?.quantity ?? null);
    const predictedUnits = candidates.map(({ proposed }) => proposed?.unit ?? null);
    const quantityCorrectAt = candidates.map((_, index) => expected.quantities == null || Object.is(predictedQuantities[index], expected.quantities[index]));
    const unitCorrectAt = candidates.map((_, index) => expected.units == null || Object.is(predictedUnits[index], expected.units[index]));
    const appendOnly = isAppendOnlyExtraction(analysis);
    const caseAppendOnlyCorrect = expected.appendOnly == null || appendOnly === expected.appendOnly;
    const evidenceAligned = alignedEvidence(analysis, fixture.text, fixture.context?.sourceAudioId ?? fixture.context?.audioId);
    candidateCount += candidates.length;
    correctIntentCount += intentCorrect.filter(Boolean).length;
    if (expected.targetIds != null) { targetCount += candidates.length; targetCorrect += targetCorrectAt.filter(Boolean).length; }
    if (expected.requiresChoice != null) { choiceCount += candidates.length; choiceCorrect += choiceCorrectAt.filter(Boolean).length; }
    if (expected.quantities != null) { quantityCount += candidates.length; quantityCorrect += quantityCorrectAt.filter(Boolean).length; }
    if (expected.units != null) { unitCount += candidates.length; unitCorrect += unitCorrectAt.filter(Boolean).length; }
    const expectedPriceCases = expected.priceRoles?.filter((role) => role != null).length ?? 0;
    if (expectedPriceCases > 0) { priceRoleCount += expectedPriceCases; priceRoleCorrect += casePriceRoleCorrect ? expectedPriceCases : 0; }
    if (expected.appendOnly != null) { appendOnlyCount++; appendOnlyCorrect += caseAppendOnlyCorrect ? 1 : 0; }
    reviewCount += candidates.filter(({ intent }) => intent === 'review').length;
    resolutionProxyCount += candidates.filter(({ intent, requiresChoice }) => intent === 'review' || requiresChoice || intent === 'ambiguous').length;
    alignedCandidateCount += candidates.length && evidenceAligned ? candidates.length : 0;

    candidates.forEach((candidate, index) => {
      const expectedIntent = expected.intents[index] ?? 'missing';
      const metric = perIntent[expectedIntent] ??= emptyIntentMetrics();
      metric.cases++;
      if (intentCorrect[index]) metric.correct++;
      const autoRoute = candidateIsActionable(candidate);
      if (autoRoute) actionableCount++;
      if (candidate.intent === 'review') metric.review++;
      else metric.proposals++;
      if (autoRoute) metric.actionable++;
      const expectedResolution = expected.requiresHumanResolution?.[index] ?? ['review', 'ambiguous', 'query', 'noop'].includes(expectedIntent);
      let unsafe = Boolean(expectedResolution && autoRoute);
      if (autoRoute && ['review', 'ambiguous', 'query', 'noop'].includes(expectedIntent)) unsafe = true;
      if (expectedIntent === 'review' && ['add', 'increment', 'set', 'remove', 'update-attribute'].includes(candidate.intent)) unsafe = true;
      if (autoRoute && expectedIntent !== candidate.intent && ['add', 'increment', 'set', 'remove', 'update-attribute'].includes(expectedIntent)) unsafe = true;
      if (autoRoute && expected.targetIds && !targetCorrectAt[index]) unsafe = true;
      if (autoRoute && expected.priceRoles?.[index] != null && candidate.assertion?.role !== expected.priceRoles[index]) unsafe = true;
      if (unsafe) unsafeRouteCount++;
      const forbiddenForeignTarget = (candidate.targetItemIds ?? []).some((id) => {
        const item = (fixture.context?.items ?? []).find((row) => row.id === id);
        return item?.listId != null && item.listId !== fixture.context?.listId;
      });
      if (forbiddenForeignTarget) unsafeRouteCount++;
    });

    caseResults.push({
      id: fixture.id,
      split: 'held-out',
      provenance: fixture.provenance,
      route: routed.route,
      candidateCount: candidates.length,
      expectedIntents: expected.intents,
      predictedIntents: candidates.map(({ intent }) => intent),
      expectedQuantities: expected.quantities ?? null,
      predictedQuantities,
      expectedUnits: expected.units ?? null,
      predictedUnits,
      intentExact: caseIntentCorrect,
      targetExact: expected.targetIds == null ? null : caseTargetCorrect,
      choiceExact: expected.requiresChoice == null ? null : caseChoiceCorrect,
      priceRoleExact: expected.priceRoles == null ? null : casePriceRoleCorrect,
      appendOnlyExact: expected.appendOnly == null ? null : caseAppendOnlyCorrect,
      evidenceAligned,
      requiresChoice: candidates.map(({ requiresChoice }) => requiresChoice),
      expectedHumanResolution: expected.requiresHumanResolution ?? null,
      expectedAppendOnly: expected.appendOnly ?? null,
      reviewCount: candidates.filter(({ intent }) => intent === 'review').length,
      latencyMs: Number(latencyMs.toFixed(3)),
    });
  }

  for (const metric of Object.values(perIntent)) {
    metric.accuracy = metric.cases ? metric.correct / metric.cases : null;
    metric.proposalCoverage = metric.cases ? metric.proposals / metric.cases : null;
    metric.safeActionCoverage = metric.cases ? metric.actionable / metric.cases : null;
    metric.reviewRate = metric.cases ? metric.review / metric.cases : null;
  }
  const totalCases = fixtures.length;
  return {
    schemaVersion: 1,
    baseline: 'deterministic JavaScript analyzer',
    evaluatedSplit: 'held-out',
    generatedAt: new Date().toISOString(),
    fixtureProvenance: 'Hand-constructed regression fixtures from design/spec examples; not blinded and not transcribed speech.',
    fixturePartitions: { train: 'validated for disjointness only; not evaluated', dev: 'validated for disjointness only; not evaluated', heldout: totalCases },
    promotion: { modelPromoted: false, decision: 'No model experiment justified or available; retain deterministic baseline and collect real dictations.' },
    metrics: {
      caseCount: totalCases,
      parserFailureFixtures: fixtures.filter(({ parserFailure }) => parserFailure).length,
      candidateCount,
      exactIntentAccuracy: candidateCount ? correctIntentCount / candidateCount : 0,
      perIntent,
      targetResolutionAccuracy: targetCount ? targetCorrect / targetCount : null,
      requiresChoiceLabelAccuracy: choiceCount ? choiceCorrect / choiceCount : null,
      quantityAccuracy: quantityCount ? quantityCorrect / quantityCount : null,
      unitAccuracy: unitCount ? unitCorrect / unitCount : null,
      priceRoleAccuracy: priceRoleCount ? priceRoleCorrect / priceRoleCount : null,
      appendOnlyRoutingAccuracy: appendOnlyCount ? appendOnlyCorrect / appendOnlyCount : null,
      proposalCoverage: candidateCount ? (candidateCount - reviewCount) / candidateCount : 0,
      safeActionCoverage: candidateCount ? actionableCount / candidateCount : 0,
      abstentionReviewRate: candidateCount ? reviewCount / candidateCount : 0,
      unresolvedChoiceRate: candidateCount ? resolutionProxyCount / candidateCount : 0,
      unsafeRouteCount,
      unsafeRouteRateAmongActionable: actionableCount ? Math.min(1, unsafeRouteCount / actionableCount) : 0,
      actualPersistenceCommits: 0,
      commitAuthority: 'Every proposal still requires explicit UI confirmation before persistence.',
      sourceAlignmentRate: candidateCount ? alignedCandidateCount / candidateCount : 0,
      nodeLatencyMs: { p50: Number(percentile(latencies, 0.5).toFixed(3)), p95: Number(percentile(latencies, 0.95).toFixed(3)), deviceLatency: 'not measured' },
      modelDownloadBytes: null,
      modelSize: 'not applicable; no model dependency or artifact',
      realDictationCount: 0,
      humanCorrectionEffort: 'not measured',
      resolutionCountProxy: resolutionProxyCount,
      confidenceCalibration: 'not measured; outputs are not probabilities',
      runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    },
    caseResults,
    limitations: [
      'All evaluation utterances are constructed specification fixtures, not real dictations.',
      'Some utterances also appear in existing deterministic unit tests; the holdout is disjoint only within these three fixture files, not an independent empirical benchmark.',
      'No persistence occurs in this evaluator; unsafeRouteCount is a candidate-routing proxy, not observed false commits.',
      'Correction effort is not measured; resolutionCountProxy only counts review/choice cases.',
      'Latency is a local Node measurement, not browser or device latency.',
      'Real speech, device behavior, model download size and calibrated probabilities remain unevaluated.',
    ],
  };
}

export function reportMarkdown(report) {
  const metrics = report.metrics;
  const rows = Object.entries(metrics.perIntent).map(([intent, values]) =>
    `| ${intent} | ${values.cases} | ${values.correct} | ${values.accuracy == null ? 'n/a' : `${(values.accuracy * 100).toFixed(1)}%`} | ${((values.safeActionCoverage ?? 0) * 100).toFixed(1)}% | ${((values.reviewRate ?? 0) * 100).toFixed(1)}% |`).join('\n');
  return `# Listar contextual analyzer: deterministic baseline\n\n` +
    `Generated ${report.generatedAt}. Evaluated ${metrics.caseCount} held-out fixtures; training and development partitions were checked for overlap but not evaluated.\n\n` +
    `**Provenance:** ${report.fixtureProvenance}\n\n` +
    `| Expected intent | Cases | Exact | Accuracy | Safe action coverage | Review rate |\n|---|---:|---:|---:|---:|---:|\n${rows}\n\n` +
    `## Safety and coverage\n\n` +
    `- Exact intent accuracy: ${(metrics.exactIntentAccuracy * 100).toFixed(1)}%\n` +
    `- Target resolution accuracy: ${metrics.targetResolutionAccuracy == null ? 'n/a' : `${(metrics.targetResolutionAccuracy * 100).toFixed(1)}%`}\n` +
      `- Required-choice label accuracy: ${metrics.requiresChoiceLabelAccuracy == null ? 'n/a' : `${(metrics.requiresChoiceLabelAccuracy * 100).toFixed(1)}%`}\n` +
    `- Parsed quantity/unit accuracy: ${metrics.quantityAccuracy == null ? 'n/a' : `${(metrics.quantityAccuracy * 100).toFixed(1)}%`}/${metrics.unitAccuracy == null ? 'n/a' : `${(metrics.unitAccuracy * 100).toFixed(1)}%`}\n` +
    `- Price role accuracy: ${metrics.priceRoleAccuracy == null ? 'n/a' : `${(metrics.priceRoleAccuracy * 100).toFixed(1)}%`}\n` +
    `- Append-only routing accuracy: ${metrics.appendOnlyRoutingAccuracy == null ? 'n/a' : `${(metrics.appendOnlyRoutingAccuracy * 100).toFixed(1)}%`}\n` +
    `- Proposal coverage: ${(metrics.proposalCoverage * 100).toFixed(1)}%; safe action coverage: ${(metrics.safeActionCoverage * 100).toFixed(1)}%\n` +
    `- Abstention/review rate: ${(metrics.abstentionReviewRate * 100).toFixed(1)}%; unresolved-choice proxy: ${(metrics.unresolvedChoiceRate * 100).toFixed(1)}%\n` +
    `- Unsafe candidate routes: ${metrics.unsafeRouteCount}; actual persistence commits in evaluation: 0\n` +
    `- Commit boundary: ${metrics.commitAuthority}\n` +
    `- Source alignment/evidence preservation: ${(metrics.sourceAlignmentRate * 100).toFixed(1)}%\n` +
    `- Local Node latency p50/p95: ${metrics.nodeLatencyMs.p50}/${metrics.nodeLatencyMs.p95} ms; device latency not measured\n\n` +
    `## Model and data gates\n\n` +
    `No model was run or promoted. Model download size, real dictations and human correction effort are not measured. Confidence calibration: ${metrics.confidenceCalibration}. ${report.promotion.decision}\n\n` +
    `The held-out fixture set is synthetic and supports regression evaluation only. Collect labeled real dictations and measure browser/device behavior before any model promotion or release claim.\n`;
}

async function main(args) {
  const partitions = await loadPartitions();
  validatePartitions(partitions);
  const report = {
    ...await evaluateHeldOut(partitions.heldout),
    fixturePartitions: { train: partitions.train.length, dev: partitions.dev.length, heldout: partitions.heldout.length, evaluated: ['heldout'] },
  };
  if (args.includes('--write')) {
    await mkdir(reportDir, { recursive: true });
    await writeFile(new URL('deterministic-baseline.latest.json', reportDir), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(new URL('deterministic-baseline.latest.md', reportDir), reportMarkdown(report));
  }
  process.stdout.write(args.includes('--markdown') ? reportMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
