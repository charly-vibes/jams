# jams-2vb implementation brief

## Why
The settings/export work touches the existing mic/preview UI and needs to be implemented by a named gpt-6-luna Codex child as explicitly requested. Reuse the idle child session to preserve concurrency capacity.

## Completion criteria
- `node --test listar/test/` exits 0 with coverage for persistence/defaults/invalid settings, retention on/off, audio deletion, and export formatting/fallback.
- `node --check listar/script.js` exits 0.
- `node --check listar/app-core.mjs` exits 0.
- Language/model settings persist to Listar-specific localStorage, restore validated values, and flow into worker options.
- Audio retention defaults on; off means the capture blob is not stored. Per-list clear removes that list's audio. If a global clear control is added, it clears across all lists.
- Export creates plain text from the active list and invokes Web Share when available with clipboard fallback.

## Spawn model
Reused named gpt-6-luna Codex session `jams_2ao_impl`, per-ticket followup `jams-2vb`; context ceiling ≤25% of actual model window.

## Ticket and scope
Ticket jams-2vb. Exact primary file `listar/script.js`; add testable helpers in `listar/app-core.mjs`, test in `listar/test/`, and settings/export controls to `listar/index.html`/`style.css` if required. Do not modify contextual command reducer, schema, or PWA polish beyond this ticket.

## Red/green/refactor
Inspect transcribir settings persistence and Audio/List DB contracts; first add failing tests for validated restore/save, default-on retention and opt-out, per-list audio clearing, export format, and unsupported Web Share fallback. Implement the minimum helpers/UI to pass; then Rule-of-5 review and fixes.

## Verification
Run `node --test listar/test/`, `node --check listar/script.js`, `node --check listar/app-core.mjs`, and `git diff --check`. Browser Web Share/device behavior remains unverified without an available browser.

## Follow-up threshold
Block completion if setting values do not survive reload, invalid stored values break UI, opt-out still persists audio blobs, clearing leaves records, export loses quantity/unit or checked status policy, or no fallback exists when Web Share is unavailable.

## Verifier evidence contract
Lead verification artifact must cite this brief, files read, and fresh command output. With no cross-family verifier configured, use REVIEW_REQUIRED; do not claim browser behavior.

## Policy adaptation
Direct collaboration followup is used instead of the pipeline pi wrapper because the user selected Codex subagents. Conservative policy forbids commits; this brief is uncommitted.
