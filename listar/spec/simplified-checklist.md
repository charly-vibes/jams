# Listar: simplified checklist and immutable views

Listar opens directly into a usable checklist, accepts text or audio without
requiring a collection, and lets people correct items where they read them.
This proposed specification defines the next UX for the existing device-local
PWA; it requires no accounts, remote processing, or additional model.

**Status:** proposed; not implemented. **Tracking:** Beads `jams-w6w` covers this
specification only. Implementation is tracked by epic `jams-8be`; its children
carry acceptance scenarios, file ownership and dependencies. The existing PWA
release gate `jams-0rt.1` is reused alongside a separate formative usability gate.

The authoritative tracker snapshot of this specification is the `design` field
of epic `jams-8be`. Each implementation ticket records `spec_snapshot_issue` and
`spec_sha256` metadata so a fresh checkout can recover the exact source with
`bd show jams-8be --json` and verify its SHA-256. The local file and the tracker
snapshot MUST match; later spec changes require updating the snapshot and ticket
checksums together. A git base anchor identifies code, not the uncommitted spec.

## Authority and boundaries

This document supersedes the home/list navigation, modal preview, item editing,
and settings presentation in [functionality.md](functionality.md) for the proposed
revision. Until implemented, that document describes the existing app.
[contextual-commands.md](contextual-commands.md) continues to govern interpretation,
typed attributes, source evidence, explicit confirmation, and atomic commits.
The extensions below replace its active-list-only scope with an explicit command
scope and add a coherent workspace revision for actions across derived views.

MUST denotes acceptance requirements; SHOULD denotes a preferred implementation.
The interface remains Spanish. Immutability applies to application values:
actions produce new snapshots without modifying their inputs. Durable event
sourcing, permanent revision history, custom query builders, unrestricted notebook
editing, sync, and new AI models are outside this revision. Storage may update
current records atomically; that does not permit mutation of an exposed snapshot.

## Acceptance scenarios defined before implementation

These scenarios define test inputs and outputs. They are not test results.

### Capture and correction fixtures

| ID | Given and input | Required visible and persisted result |
| --- | --- | --- |
| A01 | Empty installation; type `pan` and submit | One unassigned pending item; no collection setup or preview; success receipt only after commit. |
| A02 | Empty installation; dictate `leche, pan y huevos`; stop | Inline draft with three readable rows; no item persisted until `Agregar 3`; one atomic batch afterward. |
| A03 | Milk quantity 2 L; open its quantity editor; enter 3 L; save | Same item ID, quantity 3 L, original input snapshot unchanged; raw source and other fields preserved. |
| A04 | Three-item speech draft; remove one row and correct another | `Agregar 2` saves only the two remaining corrected proposals; no automatic merge with existing items. |
| A05 | `leche no yogur` produces unresolved alternatives | One plain-language choice; no execution of that proposal until resolved; cancel writes no items. |
| A06 | `sacá la leche` with two matching entries | Resolve the target using brand/package/collection/quantity, then ask whether to archive or detach membership; stable IDs remain internal; no guessed target or deletion. |

### Views and identity fixtures

| ID | Given and input | Required visible and persisted result |
| --- | --- | --- |
| A07 | Open `Completados`; type `pan` and submit | Create pending pan, not completed pan; visible receipt says it was saved and offers `Ver en Pendientes`. |
| A08 | One pending milk item in Compras | `Pendientes`, `Todo`, and Compras show the same ID and quantity from one snapshot, with intentional filter differences. |
| A09 | Move unassigned pan to Compras | Same ID; one membership change; absent from `Sin lista`, present in Compras; source preserved. |
| A10 | Remove Compras from saved views | Only the view definition is removed; collection and items still exist and remain available through the selector. |
| A11 | Existing populated installation opens after upgrade | Item/list IDs, optional fields, done flags, order, attributes, evidence, settings and retained audio survive; no duplicate items. |

### Recovery and concurrency fixtures

| ID | Given and input | Required visible and persisted result |
| --- | --- | --- |
| A12 | Complete milk; then choose `Deshacer` | Only completion is reverted; unchanged ID, quantity and source. |
| A13 | Complete milk; another tab edits its quantity; then undo | Fresh preconditions are checked; no old-snapshot restore; show current item and offer explicit reconfirmation if stale. |
| A14 | Confirm a three-item batch twice or retry after reopening DB | Same operation ID and payload return original outcome; exactly three items. |
| A15 | Storage rejects a save | Draft/editor stays open with entered values; no success receipt or partial item changes; retry available. |
| A16 | Audio arrives from share sheet before choosing a collection | Visible global intake card; default destination `Sin lista`; no collection gate; consume transfer only after durable local handoff. |
| A17 | First-use offline installation has no cached model | Text entry works; audio explains download requirement and offers retry/import; never claims offline transcription succeeded. |
| A18 | Changed collection or deleted target while speech draft is open | Refresh analysis; retain source and edits where still valid; show affected proposal and require fresh confirmation. |

## One starting screen

Fresh installs MUST open `Pendientes`. Later launches restore the last valid view;
a missing view falls back to `Pendientes`. No list-creation screen blocks entry.

```text
Pendientes ▾                                      ⋯

☐ Leche                                  2 litros
☐ Pan

[ Agregar algo…                                🎙 ]
Destino: Sin lista ▾
```

The view selector offers `Pendientes`, `Todo`, `Completados`, `Sin lista`, and
existing collections. Creating a collection is a secondary selector action with
one required name field; emoji is optional under customization. Users need not
learn the words snapshot, query, assertion, or projection.

The composer MUST remain reachable without scrolling through the entire list.
On small screens it SHOULD occupy a bottom region above safe-area insets; keyboard
and editor focus must not be obscured. Header actions are the view selector and a
labeled overflow menu. Copy, share, collection management, and settings belong in
that menu. Every screen has one visible global status/intake region.

Rows show completion, label, and an optional readable amount. Tap the label to
edit it; tap the amount to edit quantity/unit. Missing amounts have an accessible
`Agregar cantidad` action in row details. No always-visible per-row delete icon.
`Detalles` exposes attributes, source information, collection assignment, and
`Archivar`. Done items remain in their stable positions in collection/All views;
they leave `Pendientes` after completion, with an undo receipt remaining visible.

## Capture and confirmation

### Text is a direct item action

Enter or the visible `Agregar` control submits one typed item. Text entry MUST
NOT silently execute command-like text: typing `sacá la leche` creates that literal
label. Newlines or multiple pasted lines produce an inline multi-item draft
requiring one batch confirmation. Commas within a single typed line are literal.
Empty/whitespace-only input is rejected inline. Quantity parsing is optional only
when its proposed result is shown before submission; otherwise typed text remains
the label and structured quantity is edited directly afterward.

### Audio is interpreted, then confirmed inline

Mic tap starts recording; the same labeled control stops it. States are idle,
requesting permission, recording, processing, draft, committing, and recoverable
failure. State changes have visible text and live announcements. `Cancelar` during
processing or draft discards the item proposals; audio retention still follows
the existing user setting and is disclosed separately.

Audio decode, transcription, source filtering, and analysis stay behind this flow:

```text
record/import/share → processing → inline draft → explicit confirmation → receipt
```

Normal rows read `Leche · 2 litros`, rather than exposing a checkbox and four form
fields. Editing expands only the chosen row. `Quitar de esta captura` excludes a
proposal. No mandatory modal or separate review screen is used. Confirmation is
`Agregar N` for pure additions and `Guardar N cambios` for contextual actions.
The proposed destination is always visible before confirmation.

Every contextual change shows a short concrete summary, such as `Leche: 1 → 2
litros` or `Quitar de Compras; conservar en Sin lista`. Ambiguity is one focused question at a time,
with human-readable choices and a `Cancelar` path. Identical labels with no
distinguishing facts get stable local display aliases such as `Leche · entrada 1`;
each choice can open item details. The user may decline rather than guess.
No raw IDs, parser diagnostics, or assertion terminology appear in the normal
flow. Evidence and detailed before/after information remain available under
`Detalles`; simplification MUST NOT remove internal identity or validation.

Unresolved proposals block the batch until resolved or explicitly excluded.
Exclusion updates the confirmation count; valid selected proposals commit
atomically. Queries show answers without a save button or state mutation.
Unsupported commands remain unresolved; they MUST NOT become ordinary additions.

### Voice removal preserves the item

| Wording / intent | Proposal and confirmation | Required data effect |
| --- | --- | --- |
| `archivá la leche` → `archive-item` | Resolve exact target, then `Archivar leche` | Set archive state; preserve ID, membership, source and attributes; undo/restore remains possible. |
| `sacá la leche de Compras` → `remove-from-collection` | Resolve target and collection, then `Quitar de Compras; conservar en Sin lista` | Detach only the expected membership; do not archive, complete or delete the item. |
| `sacá/quitá/borrá/eliminá la leche` without explicit collection | After target resolution ask `¿Archivar o quitar de la lista?` with available choices and Cancelar | No action until explicit choice; detachment is offered only for an existing membership. For an unassigned item, explain that only archive is available and still require confirmation. |

An explicit collection outside the reviewed command scope requires selecting that
scope and renewed analysis before confirmation; it must not silently widen scope.
A missing or changed membership rejects detachment for fresh review. Legacy destructive
`remove` commands MUST NOT be emitted or executed by the revised ordinary UI or
voice flow. Keep any legacy API only behind an explicit compatibility boundary;
old tests do not authorize routing new capture through destructive deletion.
This rule does not change explicit audio/diagnostic erasure policies or guarded
undo of a newly added, otherwise unchanged item.

Only one active capture/draft is allowed initially. Another capture offers
`Seguir revisando` or `Descartar y reemplazar`; it never silently loses the first.
Navigation within the app preserves the draft and its explicit scope/destination.
Reload durability for unconfirmed text/editor drafts is not promised; navigating
away or reloading with unsaved input MUST trigger an available browser leave
warning. Shared intake durability is separately required below.

## Views, collections, and creation defaults

A collection is an organization entity. A saved view is a query and presentation
definition. They MUST NOT be the same entity, even when a collection shortcut
uses its name. Initially an item belongs to zero or one collection; multiple
collection membership and custom filters are deferred.

| View | Selection excluding archived items | Default for new items |
| --- | --- | --- |
| Pendientes | `done = false` | Pending, unassigned |
| Todo | All current items | Pending, unassigned |
| Completados | `done = true` | Pending, unassigned |
| Sin lista | No collection membership | Pending, unassigned |
| Collection shortcut | Membership in that collection | Pending, that collection |

`Sin lista` includes completed items with completion shown. Ordering is explicit
item order, then creation time, then ID for deterministic ties. View switching
does not write items or reorder their stored values. Each rendered screen uses
one coherent snapshot. A newly refreshed snapshot may intentionally differ from
an older screen; views over the same snapshot MUST agree on shared item facts.

Creation defaults are independent of query predicates. A destination control
allows explicit override to a collection or `Sin lista`. It resets to the next
view's defaults only for a new capture; it never retargets an existing draft.
The save receipt remains outside the filtered rows, says where the item went,
and offers a route to it if hidden. No automatic `done` or attribute changes are
made just to keep a newly created item inside a filter.

Contextual commands use the selected collection as scope, or all non-archived
items when no collection is selected. This scope MUST be shown in the draft
(`Cambios en Compras` or `Cambios en todas tus listas`). Explicitly choosing a
capture destination changes the command scope before analysis. Switching views
while reviewing does not change that scope. Duplicate matching never uses only
the visible filtered rows, and labels are never identity. A move changes membership
of the same item; it does not copy or merge it.

Removing a saved shortcut deletes only its view definition. The collection remains
in the selector. Collection removal is a separate confirmed action: explain that
its items become unassigned, then detach membership and remove the collection in
one transaction. Item archiving hides the item from the standard views; an
`Archivados` view in the selector permits restoration. Permanent item erasure is
outside this revision; explicit audio/diagnostic clearing remains supported.

## Immutable application contract

These are logical contracts, not a required on-disk schema or language-specific
API. Existing field shapes and typed-attribute validation remain compatible.

| Value | Required meaning |
| --- | --- |
| Snapshot | Immutable coherent workspace value containing items, collections, memberships and an opaque monotonic revision. |
| Item | Stable ID, label, optional structured quantity/unit, done, archive state, order, source fields, existing typed attributes. |
| Membership | Optional relation from one item ID to one collection ID; independent of view identity. |
| ViewDefinition | Stable view ID, supported query, sort and presentation; separate creation defaults. |
| Proposal | Source, candidate action, target IDs, scope and reviewed revision; no write authority. |
| Action | Explicit validated intent, targets, expected revision/preconditions, stable operation ID and payload. |

```text
project(snapshot, viewDefinition) → rows
apply(snapshot, validatedActions) → newSnapshot | validationError
commit(expectedRevision, operationId, actions) → committedSnapshot | conflict
```

`project` and `apply` MUST have no storage or DOM side effects. Invalid actions
leave every input unchanged. Unchanged entities MAY share references; callers
must never mutate any reachable snapshot value. Corrections preserve entity IDs,
raw source and unrelated attributes; completion, membership, archive state and
labels are independent fields. Source retention/erasure follows explicit policy.

Persistence MUST read a coherent workspace and atomically validate revision,
update affected records, advance revision, and store a replay receipt. All writers,
including legacy CRUD paths and collection operations, participate in the guard.
The existing per-list versions alone do not protect an all-items operation.
A conservative workspace-wide revision is the initial contract; stale actions
may reject after unrelated writes rather than risk lost updates. Identical retry
lookup precedes stale rejection; changed payload with reused operation ID fails.
Success is reported only after transaction completion.

## Editing, undo, and concurrent changes

Inline editors show `Guardar` and `Cancelar`. Save requires a nonempty label,
finite supported quantity/unit values, and existing typed validation. Omitted
quantity remains omitted; do not invent a unit or zero. On failure keep user input.

The latest successful reversible action in this tab has a visible `Deshacer`
receipt until the next successful action or tab reload. View navigation and
failed actions do not remove it. Supported actions are add batch, edit, completion,
membership change and item archive/restore. Collection removal and source erasure
are confirmed separately and are not initially undoable. Audio/diagnostic data
cleared by explicit request cannot be restored by item undo.

Undo constructs a new action against current data, reverting only the fields or
entities affected by the original action. It MUST NOT restore an entire earlier
snapshot. A newly added item can be removed by undo only if it has not since been
changed. Undo receipts carry sufficient before/after values and preconditions;
they need not be a permanent user-visible event log.

Stale saves, contextual confirmations, and undo preserve input and show
`Esto cambió en otra pestaña. Revisa el valor actual.` They refresh the relevant
data and require explicit reconfirmation before a new attempt. An absent target
offers cancel; recreating it requires an explicit new-item action. Retry after an
unknown transaction result uses the original operation ID and payload first.
An intentionally revised payload gets a new operation ID after fresh review.

## Settings, intake, accessibility, and failure recovery

| Area | Required behavior |
| --- | --- |
| Settings | One entry in overflow. Language and audio retention first; model choice under `Avanzado`; diagnostics under `Ayuda y diagnóstico`. Preserve saved values and default-off diagnostics. |
| Model preparation | Show `Preparando transcripción…`, progress and cancel; explain first download when needed. Technical decode/model details belong in diagnostics. |
| Shared/file audio | Visible global intake card, optional destination, default unassigned. Persist local handoff before consuming transfer token; retain until confirm/discard. Do not drop token merely on opening a view. |
| Pending intake | Reload recovers the durable audio intake; repeated launch deduplicates by transfer token. A second file queues behind the active draft and shows its pending count. |
| Export | Export the current visible item selection and derived quantities/status; no diagnostics/source data by default. User sees the scope before copy/share. |
| Mic denied/model failure | Explain in plain Spanish; offer typing, file import where useful, and retry. Keep existing input. |
| Storage unavailable/full | No success claim. Retain draft while tab lives; offer copy of text and retry. Cannot promise durable shared intake if storage fails. |
| Accessibility | Labeled controls; keyboard Enter saves and Escape cancels editor; focus returns to origin; recording/save/error announcements; status stays visible in every view. |
| Touch/layout | Primary interactive targets at least 44 CSS px; usable at 320 CSS px and 200% zoom; no color-only state, obscured controls, or forced horizontal scrolling. |

Shared intake uses temporary local storage independently of the long-term audio
retention setting. The intake card MUST disclose that the file is held until save
or discard. Discard deletes its temporary file; successful confirmation removes
the handoff record and retains a source audio record only when audio retention is
enabled. Failed saves keep the intake available for retry. Explicit source erasure
also clears pending files in its stated scope.

Before a shared-intake commit begins, persist its stable operation ID and frozen
payload with the intake record. On reload, check the durable commit receipt first:
an already committed operation shows its result and finishes handoff cleanup;
an uncommitted operation resumes review/retry with the same identity. Do not
re-analyze and append an already committed intake. Handoff cleanup may be retried
without duplicating items; a payload edited after a definitive failed commit gets
a new operation ID. Never replace the payload while commit outcome is unknown.

PWA shell availability does not imply an uncached model works offline. Existing
offline/share/coexistence and two-tab checks remain required in `jams-0rt.1`.

## Compatibility and implementation seams

Migration MUST preserve existing list IDs as collection IDs and item IDs as item
IDs. Legacy `listId` becomes membership through an adapter or migration; no item
copy is allowed. New unassigned items must not require a visible synthetic list.
Missing archive state means not archived. Existing absent optional fields remain
absent. Collection shortcuts can be generated from legacy lists without writing
or duplicating items.

Any new workspace metadata/store/index requires the appropriate schema upgrade,
transaction/lifecycle handling and failed-migration rollback. No migration may
silently drop attributes, provenance, replay receipts or retained audio. Preserve
the existing service-worker namespace and transcribir isolation; a changed shell
requires the existing cache-version update procedure.

| Existing seam | Required implementation responsibility |
| --- | --- |
| `index.html`, `style.css`, `script.js` | Single checklist entry, global status/intake, reachable composer, inline drafts/editor, secondary menus. |
| `app-core.mjs`, `context-review.mjs` | Direct typed actions, presentation separate from interpretation, human-readable target resolution, receipts and guarded undo. |
| `command-reducer.mjs`, `db.js` | Immutable completion/edit/membership/archive operations, workspace snapshots/revision, atomic commits/replay and migration. |
| `analyze.mjs`, `splitter.js`, worker | Retain analysis/extraction contracts and source evidence; do not make UI simplicity depend on a new parser/model. |

## Verification and release evidence

Implementation tickets MUST each name acceptance scenario IDs and follow failing
test → implementation → review/fix → commit under the active git policy.
Structural tidying is separate from behavior changes and needs separate tickets.
This document is a specification, not an implementation task queue.

Pure tests MUST freeze nested input snapshots and exercise projection, edit,
completion, scope, membership, archive and inverse-action preconditions. Persistence
tests MUST cover reopen/replay, migration preservation, cross-collection reads,
atomic failure and interleaving writers. Browser tests MUST exercise typing,
inline audio confirmation, keyboard/focus, filtered save receipts, shared intake
reload and two tabs. Existing splitter, attribute, DB and PWA regressions stay green.

Before release, run a formative test with five people unfamiliar with this revision
on named mobile devices/browsers. Each attempts capture of three items, quantity
correction, completion/undo, retrieval after a filtered save, and ambiguous-target
resolution. Record completion, time, hesitation, wrong actions, recovery and help
needed. A provisional gate is at least four of five completing each task without
facilitator instructions, with zero silent loss, wrong-target commit or false save
confirmation. Any observed data-integrity failure blocks release. This small test
is design feedback, not a population-level usability or speech-accuracy claim.

`jams-8be.12` owns the reproducible browser harness and cross-flow browser tests.
It adds `listar/playwright.config.mjs`, `listar/test/browser/workspace.browser.spec.mjs`
and a `test:browser` package script. The allowed test-only dependency is
`@playwright/test`; no browser dependency enters the production app. Configure
Node unit-test discovery to exclude browser specs while retaining all current
unit tests. Serve the checkout locally with an owned static test server and use
a Chromium project. The post-implementation browser gate is
`npm run test:browser --prefix listar -- --project=chromium`; it must execute the
browser scenarios rather than inspect source strings. Its setup, browser install
and static-server lifecycle must be documented in `listar/test/browser/README.md`.
This command is a required deliverable, not an existing passing check.

Use controlled worker responses for repeatable browser interaction tests and
actual IndexedDB/service-worker storage for reload/replay. Do not present mocked
speech as real Whisper accuracy. Installed-app/system-share/real-audio behavior
remains the separate named-device gate `jams-0rt.1`. Both that gate and the study
`jams-8be.13` depend on integrated verification and may proceed independently;
both are required for epic closure. The study is not blocked on model evaluation.

Record keyboard and screen-reader checks separately. Automated checks alone do not
establish usability or accessibility. Real dictation evaluation and release gates
remain open until their own evidence is recorded. Deployment requires separate
explicit authorization.
