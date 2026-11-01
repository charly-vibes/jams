// Purpose: keep contextual routing deterministic until a candidate adapter passes its own promotion gate.
// Responsibilities: handle no-model operation and fall back safely after optional parser failure.
// Rationale: parser/model output cannot bypass contextual analysis, confirmation, or source evidence.

import { analyze } from './analyze.mjs';

function clone(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch { /* use JSON-safe fallback */ }
  }
  try { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  catch { return value; }
}

/**
 * Analyze with the deterministic baseline. Optional parser output is deliberately
 * not promoted; errors and unvalidated outputs retain the original transcript,
 * active snapshot, and deterministic evidence for preview/review.
 */
export async function analyzeWithFallback(transcript, context = {}, { parserAttempt } = {}) {
  const source = String(transcript ?? '');
  const baseline = () => analyze(source, clone(context));
  if (typeof parserAttempt !== 'function') return { route: 'deterministic', analysis: baseline(), failure: null };

  try {
    await parserAttempt({ transcript: source, context: clone(context) });
    const analysis = baseline();
    analysis.diagnostics.push({
      code: 'parser-output-not-promoted',
      message: 'La salida del analizador alternativo no tiene un adaptador contextual validado; se conserva el análisis determinista.',
    });
    return { route: 'deterministic-unpromoted', analysis, failure: null };
  } catch (error) {
    const analysis = baseline();
    const failure = {
      name: String(error?.name ?? 'Error'),
      message: String(error?.message ?? 'El analizador alternativo falló.'),
    };
    analysis.diagnostics.push({
      code: 'parser-fallback',
      message: 'Falló el analizador alternativo; se mantiene el dictado y se usa la revisión determinista.',
    });
    return { route: 'deterministic-fallback', analysis, failure };
  }
}
