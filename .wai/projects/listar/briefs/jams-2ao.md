# jams-2ao implementation brief

## Why
This medium ticket uses the requested named gpt-6-luna Codex subagent so the epic orchestrator can verify the worker stack independently and continue dependency order.

## Completion criteria
- `node --check listar/worker.js`
- `node --test listar/test/`
- Pinned CDN URLs and required transcribe/cancel/progress/result/error/cancelled protocol remain aligned with `transcribir/worker.js`.
- Filter tests cover silence, short and low-confidence segments, timestamp attribution, fallback, and worker integration.

## Spawn model
Named gpt-6-luna Codex subagent `jams_2ao_impl`; context ceiling ≤25% of the actual model window.

## Ticket
jams-2ao. Desired outcome: port the transcribir Whisper worker stack and add transcript filtering. Scope is worker/filter only; no UI changes, model map changes, or splitting logic. Exact files: `listar/worker.js`, `listar/transcript-filter.mjs`, `listar/test/transcript-filter.test.js`.

## Red/green/refactor
The lead added failing filter fixtures first. The implementor made them pass, then performed a Rule-of-5 review. The lead independently reviewed the result and added regression tests for dropped timestamp diagnostics and zero-length audio.

## Verification and follow-up threshold
Run the completion commands above and review the full changed source. Any mismatch in protocol, lost timestamp evidence, or test regression blocks ticket completion. On-device tiny-model smoke remains a HITL release gate tracked by jams-rte.

## Evidence contract
Verification must cite this brief and the ticket acceptance criteria, then include fresh test output before recording CONFIRM. This verification is lead-side because no different model family is configured; no CONFIRM is claimed.

## Policy adaptation
The user explicitly authorized Codex subagents, overriding the pipeline's pi-only wrapper. The direct named collaboration spawn is therefore used and logged. Conservative git policy prohibits commits without explicit authorization; no brief or code commit is created.
