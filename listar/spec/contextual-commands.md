# Listar: contextual commands and typed attributes

The proposed [simplified checklist UX](simplified-checklist.md) retains the semantic
and confirmation safeguards here while replacing modal review presentation and
extending command scope beyond a single list. It is not yet implemented.
For that revision, its explicit `archive-item` and `remove-from-collection`
semantics replace ordinary voice routing to destructive `remove`. Ambiguous
removal requires a user choice; legacy reducer compatibility does not authorize
deleting items through the revised UI.

This design extends Listar beyond appending parsed items: interpretation uses the
active list to propose explicit changes, and confirmation commits them atomically.
It builds on [the v1 specification](functionality.md). The analyzer, contextual
preview, typed attributes, reducer and versioned commits are implemented; the
original `split()` interface remains compatible. Browser/device release checks
and labeled real-dictation evaluation remain open in Beads `jams-0rt.1`.

## Source and authority

Source: [Investigate Tiny Models, 2026-10-28–29](https://chatgpt.com/c/6ae2a36e-e7b0-83e9-a9ce-8783b960058d),
read from the local export at
`~/cotorreo/raw/_conversations/chatgpt/6ae2a36e-e7b0-83e9-a9ce-8783b960058d/transcript.md`.
The final source audit narrows earlier categorical and model-cascade proposals.
The [preserved source bundles](reference/README.md) retain both the detailed
Specodelic model and the audit/prototype, including their verification limits.
This addendum defines the incremental integration direction; the bundles are
historical reference, not an instruction to adopt every proposed abstraction.

Keep v1's zero-build, device-local architecture and `split(transcript)` contract.
The audio-worker and append/preview UI tickets remain v1 work. Rich commands,
attributes and model routing are separate follow-ups; they do not block v1 release.

## Separate interpretation, confirmation and persistence

Proposed flow:

```text
transcript + active-list snapshot/version
  → analyze → candidate commands + evidence + diagnostics
  → preview / resolve ambiguity / confirm
  → pure apply → versioned atomic IndexedDB commit
```

`analyze(transcript, context)` is additive and pure. It preserves alternatives and
source mentions; it never mutates the list. The final command/result shapes must
be specified with fixtures during implementation, rather than treating the
experimental prototype API as settled. Model and parser outputs are proposals.
Only validated commands selected through confirmation reach persistence.

| Intent | Example with existing leche = 1 litro | Required distinction |
| --- | --- | --- |
| Add | `agregá leche` | Presence alone does not authorize merging or incrementing; ambiguous repetition needs a choice |
| Increment | `otro litro de leche` | Propose 2 litros for an unambiguous target |
| Set quantity | `poné dos litros de leche` | Propose 2 litros, rather than adding 2 |
| Remove | `sacá la leche` | Resolve a stable entry ID; equal labels can be ambiguous |
| Update attribute | `la leche sale 2000 pesos por litro` | Propose a price observation with explicit context |
| Query/noop | `¿ya hay leche?` | Leave persisted state unchanged |

References are scoped to the active list. Labels, normalized names and optional
product references are matching aids, never entry identity. Brands, packages and
equal labels may identify distinct entries. Preview shows the target, operation,
evidence and before/after values; cancellation writes nothing. Ambiguous speech
repairs such as `leche no yogur` must not silently create both entries.

## Extend items without replacing their identity

Reuse `Item.id`, `listId`, `label`, raw `text`, quantity/unit and `sourceAudioId`.
Use `attributes: { [key]: Assertion[] }`, where each assertion has an immutable
`id`, a typed `value`, `role` (`observation`, `requirement` or `preference`) and
`evidence`. IDs are unique within an item across attribute keys. An absent
`attributes` field is valid legacy data and stays absent in its legacy projection.

Attribute commands identify the item ID, attribute key and assertion ID. Append
requires a new assertion ID and preserves every existing assertion; replace and
remove require an existing assertion at that key. Replacing retains its ID and
role; changing a role requires an explicit remove plus append. Unknown targets,
duplicate IDs or invalid values reject the whole batch. No command replaces an
entire attribute collection implicitly. Repeated source observations remain
separate unless the user explicitly edits or removes one.

For example, `price` can contain observation `obs-A` (1800 ARS/L, merchant A),
observation `obs-B` (2100 ARS/L, merchant B), and requirement `budget-1`
(maximum 2000 ARS/L). Replacing `budget-1` with 1900 leaves both observations
unchanged. Round-trip and update-isolation fixtures must cover this case and
multiple observations from the same merchant at different times.
A separate ProductRef or Assertion store is deferred until demonstrated need.
Adding a serializable field alone does not require an IndexedDB version upgrade;
new stores or indexes do. The existing `Item.add` must be extended to retain it.

A price observation carries currency, basis (per item, mass, volume or package),
observation time and source; merchant is optional. `sale 2000` and
`no más de 2000` express different roles. Missing or ambiguous currency/basis
requires correction before committing a typed price. Calculated totals are derived
estimates, never observations. Production monetary arithmetic requires an explicit
decimal or minor-unit representation and rounding policy. Do not calculate a total
from `2 kg` and `1500 ARS/package` without package-size conversion evidence.
The current persistence validator accepts mass units `mg`, `g`, `kg`, `oz`, and
`lb`; volume units `mL`, `cL`, `L`, `fl-oz`, `pt`, `qt`, and `gal`; and package
units `package`, `pack`, `box`, `bottle`, `can`, `bag`, and `dozen`. These are
canonical labels only; no conversion or arithmetic is implied.

Preserve legacy records exactly through migration and legacy projection, including
absent quantity/unit. Keep all source mentions/spans and audio references in new
analysis: the legacy splitter merges compatible duplicates and retains only the
first raw `text`. Do not reconstruct provenance from that merged output or change
legacy `split()` output silently.

## Commit commands against a versioned snapshot

`readSnapshot(listId)` returns `{ listId, version, items }` from one IndexedDB
readonly transaction spanning the list/version record and items store. Queue
both reads within that transaction, select items by `listId`, and return only on
transaction completion; an absent list or aborted read rejects. Legacy lists
without a version start at version 0 under the upgraded writer contract. Never
assemble a snapshot with independent `List.get` and `Item.list` calls.

Analysis and confirmation use that exact snapshot/version. An interleaving test
must schedule another writer while reading and demonstrate either the complete
before-state with its old version or complete after-state with its new version;
old items with a new version are forbidden. The subsequent commit must reject
an old snapshot after another writer advances the list version.

The pure reducer validates targets, quantities, units and attributes before
returning a new state. Invalid batches leave the input unchanged. Query/noop
commands are state identities. Independent attribute updates commute only on the
item projection; this is not a promise that journals, versions or all commands
commute. Incompatible units require review or explicit supported conversion.

Persist the expected list version, all item changes and an operation receipt in
one IndexedDB readwrite transaction. Report success only on transaction completion.
A repeated stable operation ID with the same payload returns the original outcome
without applying again; reuse with a different payload is rejected. A new operation
against a stale snapshot is rejected for renewed analysis and confirmation.
Replay lookup must allow an already committed identical retry despite its old
expected version. Legacy CRUD must also update the governed list version or be
prevented from bypassing the guard. A pure in-memory reducer cannot provide durable
replay protection on its own.

### Connection lifecycle and schema upgrades

The DB wrapper owns every connection. Register `onversionchange` immediately
on open success; stop new transactions on that connection and close it so its
current transactions can finish and the upgrader can proceed. Close ordinary
operation connections on transaction completion or abort, including reads and
error paths. An opening request with `onblocked` must expose a recoverable
Spanish state asking the user to close or reload other Listar tabs. It performs
no item writes and reports no success while blocked; it can resume when the
blocking connection closes. Do not spawn repeated upgrade requests on retry.

Upgrade schema and initialize new stores/indexes in `onupgradeneeded`, preserving
legacy records and treating missing list versions as 0. If upgrade aborts, keep
the previous schema/data and report failure. A tab running an older DB version
must handle `VersionError` by requesting reload instead of recreating the DB.
Tests must use the production schema version and cover upgrade after existing
CRUD, an open cooperating v1 connection, a deliberately blocking connection that
later closes, an aborted migration, and preserved items/attributes after reopen.
A browser two-tab smoke test covers the blocked/reload flow. `db.js` implements this lifecycle and its automated migration tests; browser
two-tab verification remains part of `jams-0rt.1`.

## Evaluate deterministic rules before model escalation

Begin with existing heuristics, targeted normalization/grammar and context
resolution in JavaScript. Evaluate reusable NLP tools (including a CRF) or a tiny
text structurer only against demonstrated failures. Rust/WASM is optional and
requires a measurable reuse or device-performance benefit. No statistical or
generative model is required for normal operation.

Routing may accept a candidate for preview, escalate to an available parser/model,
or request review. Acceptance here never bypasses confirmation. Model agreement
is a feature, not a correctness probability. Numerical probabilities require a
named calibrator and held-out evaluation population. Measure selective risk and
coverage, correction effort, latency and download size. Escalation failure falls
back to review; it never commits a guess.

### Separate item extraction from command proposals

There are two adapter boundaries with independent promotion gates:

| Adapter | Input/output | Scope and acceptance gate |
| --- | --- | --- |
| Item extraction | Transcript → `split()`-compatible items | Append-only item extraction; pass the existing splitter corpus, negatives and real item dictations |
| Contextual analysis | Transcript + coherent snapshot → `analyze()` candidates | Preserve intent, active-list ID/version, target item IDs, attribute assertion IDs when applicable, alternatives, diagnostics and source evidence; pass contextual command and ambiguity fixtures |

Flat `label|qty|unit` model output supports only item extraction. Its adapter must
retain raw text/evidence through verified source alignment; if alignment is
uncertain, use the heuristic output or review instead of inventing provenance.
It cannot determine an increment, set, remove, attribute edit or existing target.
No successful extraction benchmark authorizes contextual command routing.

A future contextual model requires a separate validated candidate adapter.
Unresolved targets remain explicit alternatives and never become executable
commands. Test adapters with `otro litro`, `poné dos litros`, repeated `agregá`,
price observations versus requirements, and duplicate-label targets. Unsupported
model output or model failure must preserve the transcript, snapshot and evidence
and return to deterministic contextual analysis or review. Do not silently turn
an unresolved command into a legacy append. Both adapters remain outside the
reducer and persistence boundary.

This qualifies the earlier fine-tune preference in
[the fine-tune brief](finetune-brief.md): a tiny text model remains a candidate if
needed, with the heuristic fallback. Promotion requires beating that baseline on
held-out negative and contextual fixtures and real dictations.

## Verification and implementation boundaries

The archived Specodelic pack reports lint, graph and compile success; model-check
was exploration only, with **24 unchecked claims**. Verification was blocked by
an unavailable Rust runner, and named generators/oracles remain placeholders.
The independent JS prototype has ten example tests, not production persistence or
formal proofs. Its floating-point price calculation is not production monetary
arithmetic. Browser integration was not audited.

Implementation must test legacy projection, distinct IDs with equal labels,
source preservation, intent ambiguity, query/noop identity, typed prices, failed
batch atomicity, immutable input, stale versions and replay after reopening the DB.
Use `fake-indexeddb` for durable transaction cases and a browser reload/retry smoke
gate for integration. Keep existing splitter and DB regression suites green.

Beads is the source of implementation status and dependencies:

| Ticket | Scope |
| --- | --- |
| jams-gab | Typed attributes and legacy compatibility |
| jams-bc6 | Pure analysis and source evidence |
| jams-kei | Deterministic reducer and semantic tests |
| jams-obu | Atomic versioned IndexedDB commits |
| jams-h0x | Context resolution and confirmation preview |
| jams-w4m | Parser-cascade evaluation and calibrated routing |

Repeated `agregá leche` defaults, the remaining typed-value/command codecs, monetary
rounding, unit conversions and calibration thresholds remain implementation design
decisions requiring fixtures and evidence. Until resolved, expose ambiguity in
preview rather than silently selecting behavior.
