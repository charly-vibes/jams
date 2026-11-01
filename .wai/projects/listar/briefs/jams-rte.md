# jams-rte implementation brief

## Why
This ticket finishes local PWA integration for the existing static Listar app. The user explicitly selected gpt-6-luna Codex agents; reuse the idle named session and have the lead verify its source/tests.

## Completion criteria
- `node --test listar/test/` exits 0 with PWA manifest, worker cache, and shared audio tests.
- `node --check listar/sw.js` exits 0.
- `node --check listar/script.js` exits 0.
- `listar/manifest.json` declares portrait standalone display, a real icon, audio file_handlers, and audio share_target.
- Incoming audio share is accepted by the service worker, saved locally until list selection, and handed into the existing transcription flow without a remote server.
- Offline shell includes every local JS/CSS/manifest/icon runtime dependency and cache deletion only targets Listar-owned caches.
- Local static serving alongside transcribir returns the Listar shell/assets successfully.

## Spawn model
Reuse named gpt-6-luna Codex session `jams_2ao_impl` with new per-ticket assignment jams-rte; context ceiling ≤25% of actual window.

## Ticket and scope
Ticket jams-rte. Exact primary files: `listar/manifest.json`, `listar/sw.js`, and new `listar/icon.svg`; adjust `listar/script.js` and tests only as needed for audio share handoff. No remote deploy/push, no model changes, no unrelated UI redesign.

## Red/green/refactor
First add failing node:test assertions for portrait/icon/share_target/file_handlers and offline cache scope; add a test for POST share transfer/consume/redirect using a worker harness if possible. Implement PWA metadata/icon and service worker data path, then refactor and perform Rule-of-5 review.

## Verification commands
Run `node --test listar/test/`, `node --check listar/sw.js`, `node --check listar/script.js`, manifest JSON parse, and local static GET checks for `/listar/`, `/listar/style.css`, `/listar/icon.svg`. Browser install, real share sheet and offline launch remain manual gates unless an actual browser is available.

## Follow-up threshold
Do not claim completion if audio share_target drops a file, if off-scope caches can be deleted, or if static path returns missing local assets. Do not claim remote deploy or device verification without evidence. If browser/deploy is a release acceptance gate, create a Beads follow-up blocking epic closure.

## Verifier evidence contract
Review artifact must cite this brief and files read, contain fresh command output, and record REVIEW_REQUIRED for lead-only verification. No cross-family verifier/browser is configured.

## Policy adaptation
Use direct collaboration followup instead of the pi wrapper per explicit user/parent direction. Conservative git policy forbids committing/pushing. Remote deployment is not authorized; only local serving validation is in scope.
