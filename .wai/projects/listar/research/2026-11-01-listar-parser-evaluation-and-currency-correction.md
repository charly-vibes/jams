---
tags: [pipeline-run:epic-orchestrator-2026-10-30-listar-typed-attributes-jams-gab, pipeline-step:verify]
---

# Listar parser evaluation and currency correction evidence

Date: 2026-10-31

## Evaluation implementation (jams-w4m)

- Wrote failing tests before implementation for the parser fallback/router and reproducible evaluation harness: `listar/test/analysis-router.test.js`, `listar/test/context-evaluation.test.js`.
- Added the deterministic no-model router in `listar/analysis-router.mjs`; parser exceptions and unpromoted candidate outputs preserve transcript/context and return deterministic review-safe analysis.
- Added disjoint constructed train/dev/held-out partitions in `listar/eval/fixtures/`. Only the 16 held-out fixtures are evaluated. The sentences are synthetic/constructed regression examples, including some reused from unit tests; this is not a real-speech or independent empirical benchmark.
- Added repeatable CLI/report via `npm run eval:context`, `listar/eval/evaluate.mjs`, and `listar/eval/README.md`; generated `listar/eval/reports/deterministic-baseline.latest.json` and `.md`.
- Current synthetic held-out report: 16 examples; exact intent, target/choice, quantity/unit, price role, append-only-route, and evidence alignment checks report 100% on this fixture set; safe proposal/action coverage about 27.8%; review/choice rate about 38.9%; analyzer-vs-label unsafe-route proxy 0; no persistence commits are executed by eval. Do not interpret these figures as real-world accuracy or production false-commit rates.
- The report explicitly excludes probability/calibration claims, real dictations, measured human correction, browser/device latency, and model download size. Runtime timings are local Node only. No evidence justifies model escalation or promotion; `finetune-brief.md` was not changed.
- `analysis-router.mjs` is in `listar/sw.js` shell precache/import closure.

## Currency correction (jams-h0x follow-up)

A review found the price preview displayed raw minor-unit integers and assumed two fraction digits. Corrected preview display, parsing, and persistence conversion to derive fraction digits from `Intl.NumberFormat` for the selected currency, retaining spoken major-unit values when the user selects a currency. Added JPY (0 decimals), ARS (2), and KWD (3) display/round-trip coverage and included KWD in supported typed currency validation. Targeted context/attributes/analyze suite: 38/38 pass.

## Verification and review

- `npm run eval:context` regenerated both reports successfully.
- `npm test`: `node --test test/` passes 165/165, 0 failures.
- `node --check analyze.mjs`, `analysis-router.mjs`, `context-review.mjs`, `eval/evaluate.mjs`, `script.js`, and `sw.js`: pass.
- `git diff --check`: pass.
- Rule-of-5 review addressed correctness and scope issues: report separates fixture labels from empirical evidence; unsafe route is compared with expected fixture labels rather than router self-report; quantity/unit are evaluated; mandatory UI confirmation is not bypassed by parser flags; no model claims are made.

## Release blockers / explicit gaps

Keep `jams-0rt.1` open. Obtain genuine consented dictations and independent held-out labels; run installed browser/device checks for portrait/install, share sheet and file handler, offline reload, and coexistence with transcribir. Measure device latency/download size and human correction effort before any promotion decision. No browser/device evaluation or deployment was performed here.

