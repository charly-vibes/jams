# jams-4ud implementation brief

## Why
The UI ticket is a coherent cross-file PWA surface and the user explicitly authorized gpt-6-luna Codex subagents per ticket. Reusing the idle named child session preserves capacity while keeping implementation isolated from the orchestrator review.

## Completion criteria
- `node --test listar/test/` exits 0 with coverage for core UI behaviors and application integration.
- `node --check listar/script.js` exits 0.
- `node --check listar/sw.js` exits 0.
- `node --check listar/worker.js` exits 0.
- App reads/writes real List/Item/Audio stores from `listar/db.js`; home lists support create/open/rename/delete; list view supports check/delete/clear done.
- Mic and upload paths decode audio to mono 16 kHz Float32Array, call worker with required message protocol, display progress/errors/cancel, and render empty as “no se escuchó nada claro”.
- Transcript flows through unchanged `split()` to editable preview preserving label, raw text, quantity, and unit; confirming appends selected rows exactly once.
- Manifest/share target and offline shell work as declared by ticket. No browser/device claim without actually running it.

## Spawn model
Named gpt-6-luna Codex agent session `jams_2ao_impl` reused via followup for the new ticket `jams-4ud`; context ceiling ≤25% of the actual model window.

## Ticket and scope
Ticket: jams-4ud. Desired outcome: functional home/list UI, recording/upload to Whisper, and safe editable append preview. Exact UI files: `listar/index.html`, `listar/style.css`, `listar/script.js`, `listar/manifest.json`, `listar/sw.js`; add `listar/test/` tests as needed. Out of scope: settings/export/audio retention ticket jams-2vb, PWA icon/deploy polish ticket jams-rte, contextual command candidate workflows.

## Red/green/refactor
Inspect current DB/splitter contracts; write failing tests for UI shell, store-backed navigation/actions, preview selection/edit/append, audio decode/transcription, and empty/error states; implement to green; then perform Rule-of-5 review and fix findings in separate edits.

## Verification commands
Run `node --test listar/test/`, `node --check listar/script.js`, `node --check listar/sw.js`, and `node --check listar/worker.js`. Run a real browser smoke only if a local browser harness is available; otherwise state the exact runtime gap and leave device-level evidence for HITL.

## Follow-up threshold
Block completion on missing acceptance behavior, tests failing, data written outside IndexedDB, repeated append on one confirmation, audio kept non-mono/not 16 kHz, or losing quantity/raw phrase in preview. Keep browser/device checks as explicit follow-up where no harness exists.

## Verifier evidence contract
The lead-side review artifact must cite files and this brief, then include fresh test output before recording any verdict. No second model family is configured; record REVIEW_REQUIRED when review is lead-side only.

## Policy adaptation
The user-authorized Codex subagent model overrides the pipeline's pi wrapper. Direct named `followup_task` is used to reuse the gpt-6-luna session. Conservative git instructions still prohibit committing; the brief is therefore durable but uncommitted.
