// Purpose: pin the presentation/analysis seam for contextual confirmation (jams-8be.4).
// Responsibilities: prove the DOM preview layer lives in context-preview.mjs while
//   context-review.mjs keeps re-exporting it so existing importers are unchanged.
// Rationale: this is a behavior-preserving Tidy First refactor; the only contract
//   change is the new module seam, so the seam itself needs executable evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as preview from '../context-preview.mjs';
import * as review from '../context-review.mjs';

test('context-preview.mjs owns the DOM presentation exports', () => {
  for (const name of ['getContextPreviewCards', 'previewContextCandidate', 'renderContextPreview', 'bindContextConfirmation']) {
    assert.equal(typeof preview[name], 'function', `context-preview.mjs must export ${name}`);
  }
});

test('context-review.mjs re-exports the presentation API unchanged', () => {
  for (const name of ['getContextPreviewCards', 'previewContextCandidate', 'renderContextPreview', 'bindContextConfirmation']) {
    assert.equal(review[name], preview[name], `context-review.mjs must re-export ${name}`);
  }
});

test('context-review.mjs keeps the analysis and confirmation exports', () => {
  for (const name of ['prepareContextReview', 'createContextConfirmation', 'isAppendOnlyExtraction', 'currencyMinorDigits', 'amountToMinor', 'formatMinorAmount']) {
    assert.equal(typeof review[name], 'function', `context-review.mjs must keep ${name}`);
  }
});
