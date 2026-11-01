# jams-gab implementation brief

## Why
This ticket establishes the stable typed-attribute contract needed by pure analysis and reducers. A named gpt-6-luna Codex child implements it under the user's explicit delegation request; the lead audits the persistence and contract.

## Completion criteria
- `node --test listar/test/` exits 0 with fake-indexeddb coverage for legacy records, equal-label stable IDs, invalid assertion IDs/roles/price basis, add/put/get round-trip, and observation/requirement isolation.
- `node --check listar/db.js` exits 0.
- `node --check listar/app-core.mjs` exits 0 if helpers are added.
- Legacy items without `attributes` remain without it in the stored/projection shape and preserve old fields including quantity/unit values or absence.
- `attributes` is a map from key to Assertion[]; each assertion has immutable within-item ID, typed value, role (observation/requirement/preference), and evidence. IDs cannot repeat across keys.
- Price observations require currency, valid basis, ISO observation time and source. Price requirements/preferences are distinct and do not need observation source/time. Two merchant/time observations and one budget requirement round-trip together; replacing the budget assertion preserves both observations.
- No monetary arithmetic occurs in this ticket.

## Spawn model
Reuse named gpt-6-luna Codex session `jams_2ao_impl` with per-ticket assignment jams-gab; context ceiling ≤25% of actual model window.

## Design decision
Represent price using integer minor units (`amountMinor`) plus uppercase ISO currency code, basis (`item`, `mass`, `volume`, `package` with explicit unit and positive quantity where applicable), observation timestamp and source. No arithmetic/rounding is performed here; require exact integer minor units at the persistence boundary. Evidence stores source phrase and optional offsets/audio reference. Generic non-price typed values remain JSON-serializable values. Keep schema v1: this only adds serializable item fields and creates no store/index.

## Ticket and scope
Primary file `listar/db.js`; test `listar/test/db.test.js` or new `listar/test/attributes.test.js`; optional small reusable validator in `listar/` if justified. Do not implement command reducer, analyzer or atomic DB journal here. No separate product/assertion store.

## Red/green/refactor
Write failing fake-indexeddb tests first; implement validation and add/put/get persistence; then Rule-of-5 review, tidy, and re-run legacy DB/splitter/app/PWA suite.

## Verification commands
Run `node --test listar/test/`, `node --check listar/db.js`, optional helper syntax check, and `git diff --check`.

## Follow-up threshold
Block if legacy absence is rewritten, assertion IDs collide across keys, invalid observations are stored, one observation overwrites another, replacing budget loses observations, schema version changes without need, or tests regress.

## Verifier evidence contract
Review report cites this brief, spec §Extend items, changed source/tests and fresh test output. No cross-family verifier configured, so use REVIEW_REQUIRED and do not claim model/browser evaluation.

## Policy adaptation
Use direct followup through collaboration instead of pi wrapper. Conservative git policy prohibits commit/push; keep the brief uncommitted.
