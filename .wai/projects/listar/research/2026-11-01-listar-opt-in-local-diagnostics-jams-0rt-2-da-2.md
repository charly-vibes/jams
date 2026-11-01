---
tags: [pipeline-run:epic-orchestrator-2026-10-30-listar-typed-attributes-jams-gab, pipeline-step:verify]
---

# Listar opt-in local diagnostics — jams-0rt.2

Date: 2026-11-01

## Test-first implementation

Added `listar/test/debug.test.js` before the implementation. Initial red was the missing `debug.mjs` module. Tests now cover default-off logging, independent text capture, default redaction, historical export redaction after opting out, count/byte bounds and dropped count, clear/dispose, storage denial with session-memory fallback, neutral-key Blob/File/ArrayBuffer/DataView/typed-array omission, document click/input/change/submit capture and disposal, real IndexedDB transaction/atomic commit/replay/stale/open-error hooks, and actual `transcribeWithWorker` request/progress/result/error hooks with correlation and listener cleanup.

Added versioned JSON logging with a local settings UI. Metadata-only mode uses a strict field allowlist; document interactions read only vetted stable `id` or `data-debug-target`, tag/control/event/action, never `aria-label` or `textContent`. Dynamic item and preview controls have stable diagnostic targets. Input/checkbox state and error messages are included only when the separate text-capture option is on. Dictated/edited text under arbitrary keys is redacted by default; disabling text capture redacts previously captured text in exports. Binary values are omitted by type regardless of their key and regardless of text capture.

The persistent localStorage ring is capped at 500 events or 256 KiB, dropping oldest events and reporting the count. When storage is absent or fails, an in-memory bounded buffer remains usable for the current session; diagnostics exceptions do not escape to application flows. No network call is made and audio blobs/samples are never logged. Events have timestamps, session and ordered sequence, plus request/correlation/operation IDs where available.

Hooks cover semantic navigation/settings/list/item actions, mic/decode/transcription, actual worker `step`/`chunks` message protocol and errors, analysis/preview resolution/confirmation, DB open/blocked/error and transaction/commit/replay/stale outcomes, and uncaught window errors. No service-worker or browser-internal events are captured or relayed. This exact boundary is stated in the UI/spec. `debug.mjs` is in SW precache; cache version is `listar-shell-v2`.

## Rule-of-5 review

1. Privacy: tightened arbitrary payloads to allowlisted metadata; neutral-key binary tests; text opt-in controls input/error inclusion; exports redact historical captured text after opting out.
2. Failure behavior: storage failures use a bounded in-memory fallback; logger operations catch storage errors; app/worker/DB behavior continues.
3. Durability and bounds: deterministic sequence/timestamps/session and optional IDs; encoded-size and event-count caps; drops counted; clear and dispose covered.
4. Integration: IndexedDB tests run actual production CRUD, open failure and atomic receipt replay/stale flow; worker tests drive actual bridge event listeners with protocol-shaped progress/result/error, correlation and cleanup; document capture harness exercises interaction event types with opt-in/out; app-shell test verifies transitive import precache and cache rotation.
5. Scope/UX: settings expose default-off event logging, a separate text toggle, download and clear; UI shows 500 / 256 KiB cap and no-network/no-audio/browser/SW limits. No claim is made to capture every browser event.

## Verification

- `node --test test/debug.test.js test/app-shell.test.js`: 16/16 pass.
- `npm test` from `listar/`: 176/176 pass, 0 failures.
- `node --check debug.mjs`, `db.js`, `app-core.mjs`, `context-review.mjs`, `script.js`, `sw.js`: pass.
- `git diff --check`: pass.

No real browser was available for settings-dialog/download interaction smoke. No service-worker/browser-internal event relay was implemented by design. No commit or push; ticket remains in progress for lead review.

