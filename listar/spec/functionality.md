# Listar — Voice-Powered Lists

## Purpose

Create and manage lists (shopping, tasks, ideas) entirely by voice. Speak, and the
app turns the transcript into list items — quantities included. Multiple lists,
appendable via successive recordings. No server, no file uploads, no API keys:
everything runs on-device, like its sibling PWA `transcribir`, whose audio stack
this app reuses.

## Core Loop

```
[pick list] → [🎤 record / upload / share audio] → [Whisper transcript]
            → [transcript filter (silence/hallucination guard)]
            → [item splitter strategy] → [preview with checkboxes]
            → [confirm] → [items appended to list]
```

Repeat the audio step as many times as needed — every new recording appends
more items to the current list.

## Reuse from `transcribir`

| Component | Source | Reuse |
|-----------|--------|-------|
| Whisper worker | `transcribir/worker.js` | Copy nearly verbatim: transformers.js in module worker, CDN fallbacks, abort/retry/progress, chunked 30s inference |
| Audio decode | `transcribir/script.js` | Decode → mono mix → 16 kHz resample pipeline |
| Mic recording | `transcribir/script.js` | MediaRecorder flow, timer, mic-info UI |
| Share/file intake | `manifest.json` | `share_target` (WhatsApp audio) + `file_handlers` |
| Theme/layout | `transcribir/style.css` | Dark theme, portrait mobile, big central button |

## Data Model (IndexedDB)

```
List  { id, name, emoji, createdAt, order }
Item  { id, listId, label, text, quantity?, unit?, done, createdAt, order, sourceAudioId? }
Audio { id, listId, blob, transcript, model, createdAt }
```

- **`label`** — normalized product/task name (`leche`). What the UI renders,
  what the preview edits, what duplicate-merging matches on.
- **`text`** — the raw spoken phrase (`2 litros de leche`), preserved untouched
  for audit and debug. Never displayed by default.
- **Quantities are structured** — parsed into `quantity`/`unit` when recognized.
- **Multiple lists** — home screen grid of lists; create, rename (emoji + name), delete.
- **Audio blobs kept by default** ("guardar audios" setting, default: **on**) — enables
  re-transcription with a better model later and debugging of bad splits.
  Per-list and global clear.

## Transcript Filter (silence / hallucination guard)

Whisper hallucinates on silence and noise (e.g. "Gracias por ver el video…"),
and the chunked pipeline concatenates every chunk's text. Before splitting:

1. Drop segments shorter than ~2 words or below a minimum confidence when available.
2. If the filtered transcript is empty → show "no se escuchó nada claro" state,
   append nothing.
3. Reuse transcribir's per-chunk timestamps to attribute dropped segments.

## Item Splitter (deterministic, no LLM in v1)

Pure module (`splitter.js`, ESM — importable by both the browser and `node:test`),
defined as a **strategy** with the contract:

```
split(transcript: string) → [{ label, text, quantity?, unit? }]
```

This contract is the seam for a future optional "smart mode" (v2,
opt-in, capability-gated) — it plugs in behind the same interface without
touching the data model or the preview UX.

### Splitting procedure

1. **Explicit markers first** — numbered (`1.`, `1)`, `uno)`) and bulleted
   (`-`, `•`, `*`), plus line breaks — produce segments.
2. **Connectors within marker-free segments only** — `y`, `e`, `,`, `luego`,
   `después`, `también`, `además`. A connector splits **only when followed by a
   plausible item start**, defined as: a determiner (`el/la/un/una/unos/unas`),
   a quantity token (digit or number word), or a known-product-ish noun phrase
   (≥3 letters, not a stopword). This predicate is normative — it is the test fixture.
3. **Fallback** — no markers/connectors → one item: `{ label: raw phrase }`.
4. Negative fixtures: phrases containing connector words that must NOT split
   (e.g. product names) are part of the golden corpus.

### Quantity parsing per segment (Spanish-first, English fallback)

Canonical rule: quantity stays structured; **container/count words (docena,
paquete, caja) remain as `unit` with their count — never multiplied into digits**;
physical measures (litro, kilo, gramo…) keep the parsed number as `quantity`.

| Spoken | label | qty | unit |
|--------|-------|-----|------|
| `2 litros de leche` | `leche` | 2 | litros |
| `medio kilo de tomates` | `tomates` | 0.5 | kilo |
| `leche por dos` / `leche x2` | `leche` | 2 | — |
| `una docena de huevos` | `huevos` | 1 | docena |
| number words (`dos`, `tres`, `un par de`, …) | normalized to digits |

- **Dangling quantity** — unit/number without a product (`"2 kilos de arroz y
  un litro"`) → item keeps the full raw phrase as `label`, preview lets the user fix it.
- **Duplicates** — same `label` (case/append-insensitive) within a merge window
  → quantities summed when units match; otherwise both kept, flagged in preview.
- Unknown/unparseable quantities stay inside `text` untouched.
- **The preview step is the safety net**: parsed items are shown with checkboxes
  and editable `label`/quantity before anything is committed.

## UX

```
Home                        List view
┌──────────────────────┐    ┌──────────────────────┐
│ Listas        [ + ]  │    │ 🛒 Compras      ⚙️    │
│ ┌──────┐ ┌──────┐    │    ├──────────────────────┤
│ │🛒    │ │✅    │    │    │ ✓ Leche ×2 L         │
│ │Compras│ │Tareas│   │    │ ○ Pan                │
│ └──────┘ └──────┘    │    │ ○ Tomates ×½kg       │
│                      │    ├──────────────────────┤
│                      │    │ [     🎤      ]      │
│                      │    │  00:12 · grabando…   │
│                      │    │  + subir audio       │
└──────────────────────┘    └──────────────────────┘
```

- **Big central mic button** (same feel as transcribir) → record → transcribe →
  **preview parsed items** → confirm appends.
- Items: tap to check off, ×/swipe to delete. Checked items stay in place;
  "clear done" action. (Drag reorder = v2; v1 = new items at bottom.)
- Export: copy as plain text, Web Share.
- Settings: language, Whisper model, guardar audios on/off (default on), clear audio.
- Spanish UI; same dark aesthetic and PWA chrome (manifest, service worker,
  offline-first) as transcribir.

## Architecture

Same zero-build static shape as transcribir:

```
listar/
├── index.html
├── style.css
├── manifest.json
├── sw.js
├── splitter.js      ← pure strategy, tested with node:test
├── db.js            ← IndexedDB wrapper
├── script.js        ← UI wiring
├── worker.js        ← copied from transcribir
└── test/            ← node:test suites + golden-corpus fixtures
```

## Failure Modes

- Mic permission denied → explanatory state, upload path still available.
- Model download failure / both CDNs down → error state with retry; cached model used when present.
- Empty/hallucinated transcript → Transcript Filter handles (above); nothing appended silently.
- Storage unavailable (private mode) → read-only warning; transcription still works.

## Smart Mode (v2 plan): fine-tuned tiny structurer

The preferred v2 path for smarter splitting is a **fine-tuned tiny text model**
(SmolLM/mT5-class, ONNX, ~30–150 MB q4) mapping `transcript → items` — *not* an
instruct LLM (too heavy, see review) and *not* an end-to-end fine-tuned Whisper
(synthetic-audio domain gap; loses the transcript). Training data is pure
text→text, synthesizable at scale from templates + injected noise.

- Plugs into the strategy contract above; heuristic splitter remains the
  fallback (model not downloaded / low-memory device).
- Emits a flat line format parsed by a trivial reader — no JSON grammar decoding.
- **Promotion gate:** must beat heuristics on the golden corpus AND the negative
  fixtures, validated on real dictation samples, before becoming default.

## Verification

- **Meter:** `node --test listar/test/` — green is the gate for splitter and db tickets.
- **Golden corpus:** `listar/test/fixtures/*.txt` — one transcript per line-class
  (markers, connectors ± negatives, quantities, dangling, duplicates, empty/silence)
  with expected `split()` output asserted.
- **On-device smoke:** tiny model, short known sample → correct items (HITL release gate).

## V1 Scope / Non-Goals

- **No LLM in v1** — splitting is deterministic; the strategy contract leaves room
  for an opt-in local "smart mode" in v2 without changing the data model.
- **No sync, no accounts** — device-local.
- **No recurring lists / templates** — v2 candidates.
- **Connectors/quantities are Spanish-first** — English fallback covers quantities
  only; mixed-language dictation may split inconsistently in v1.
