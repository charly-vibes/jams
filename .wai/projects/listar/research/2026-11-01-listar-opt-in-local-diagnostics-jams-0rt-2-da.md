---
tags: [pipeline-run:epic-orchestrator-2026-10-30-listar-typed-attributes-jams-gab, pipeline-step:verify]
---

# Listar opt-in local diagnostics — jams-0rt.2

Date: 2026-10-31 / 2026-11-01 UTC

## Test-first implementation

Added `listar/test/debug.test.js` before the implementation. Initial red was the missing `debug.mjs` module. Tests cover default-off logging, independent text capture, default redaction, historical export redaction after opting out, byte/event bounds and dropped count, clear/dispose, storage denial with session-memory fallback, Blob/File/ArrayBuffer/DataView/typed-array omission under neutral keys, actual IndexedDB CRUD/commit/replay/stale/open-error hooks, and real `transcribeWithWorker` message/progress/result/error hooks with listener cleanup and correlation IDs.

Added a versioned JSON diagnostic module, settings controls, download/clear actions, app-level hooks, spec notes, and SW precache entry. The event store is localStorage-bounded to 500 events / 256 KiB, oldest first; persistent-storage errors fall back to session memory and never escape into app operations. Text-bearing fields and unknown strings are redacted by a strict metadata allowlist unless the separate text-capture opt-in is enabled. Disabling text capture sanitizes historical text in exports. Binary values are omitted by value type and known binary key regardless of text opt-in. There is no network call or audio content in diagnostic hooks.

Worker events use the actual worker protocol fields (`step`, `chunks`) and omit message/transcript content. DB hooks distinguish open/blocking failures, transaction lifecycle, atomic commit, receipt replay, stale snapshot and commit errors with operation IDs and no payload. Context/app hooks record semantic navigation/settings, mic/decode/transcription, analyzer/preview resolution/confirmation, and window-level uncaught errors.

## Rule-of-5 self-review

1. **Privacy:** rejected generic source/text keys as safe; only enumerated metadata is retained by default; export test verifies transcript redaction after opting out; neutral-key binary test proves Blob/File/ArrayBuffer/views are not serialized.
2. **Failure behavior:** localStorage read/write/remove failures are caught; bounded in-memory fallback retains logging/export for the session; diagnostic API failures do not interrupt app work.
3. **Persistence and bounds:** append sequence/timestamps/session and optional request/correlation/operation IDs; max count and encoded byte size enforced; oldest records dropped and counted; clear removes buffer; dispose stops subsequent writes.
4. **Integration:** real fake-IndexedDB production operations assert transaction/commit/replay/stale/open-error events; actual worker bridge events assert protocol fields, correlation, errors/results, and listener cleanup; static app-shell test confirms `debug.mjs` is in the transitive local-import precache closure.
5. **Scope and UX:** settings are opt-in; text capture is a separate toggle; export/clear are reachable in settings; in-app/spec text explains device-local storage, no network/audio, bounded retention, and that service-worker/browser-internal events are not captured. No claim is made to capture every browser event.

## Verification

- `node --test test/debug.test.js test/app-shell.test.js`: 15/15 pass after latest additions.
- `npm test` from `listar/`: 175/175 pass, 0 failures.
- `node --check debug.mjs`, `db.js`, `app-core.mjs`, `context-review.mjs`, `script.js`, `sw.js`: pass.
- `git diff --check`: pass.

No browser runtime was available to exercise dialog downloads/settings in a real browser. The service worker does not relay its own events by design and this limitation is stated in UI/spec. No commit/push performed; lead review pending.

