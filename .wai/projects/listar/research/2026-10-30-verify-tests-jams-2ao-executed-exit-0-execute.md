---
tags: [pipeline-run:epic-orchestrator-2026-10-30-listar-voice-powered-lists-pwa, pipeline-step:verify]
---

VERIFY-TESTS jams-2ao — REVIEW_REQUIRED (lead-side only): executed node --check listar/worker.js — exit 0; executed node --test listar/test/ — exit 0; ▶ List store
  ✔ add returns record with id, name, emoji, createdAt, order (6.371073ms)
  ✔ get retrieves by id (1.367617ms)
  ✔ all returns ordered by order asc (2.210375ms)
  ✔ put updates record (1.04531ms)
  ✔ del removes record (0.834943ms)
✔ List store (12.906737ms)
▶ Item store
  ✔ add returns record with all fields incl listId, done:false (0.83354ms)
  ✔ list returns items for listId ordered by order asc (1.12011ms)
  ✔ put updates item (0.810948ms)
  ✔ del removes item (0.719085ms)
✔ Item store (3.818414ms)
▶ Audio store
  ✔ add returns record with listId, blob, transcript, model, createdAt (1.473336ms)
  ✔ byList returns audio for listId ordered by createdAt asc (0.68441ms)
  ✔ del removes audio (0.556017ms)
✔ Audio store (2.896417ms)
✔ numbered markers with dots: "1." each become items (1.988156ms)
✔ numbered markers with paren: "1)" (0.161484ms)
✔ Spanish ordinal marker "uno)" (0.128953ms)
✔ dash bullets (0.144432ms)
✔ bullet dot "•" and asterisk "*" (0.269678ms)
✔ plain line breaks split into items (0.908611ms)
✔ mixed markers: numbers, bullets and bare lines coexist (0.152407ms)
✔ inline markers on a single line split too (0.387029ms)
✔ no markers/connectors, single line → fallback: whole transcript is one item (0.21762ms)
✔ items carry raw text equal to label at this phase (0.209314ms)
✔ markers are stripped but inner text is preserved verbatim (0.22803ms)
✔ marker-only line yields no empty item (0.159049ms)
✔ empty and whitespace-only input → no items (0.116349ms)
✔ comma splits marker-free segments (0.465236ms)
✔ "y" splits when followed by a product (0.07954ms)
✔ "e" copulative splits (0.086543ms)
✔ adverb connectors: luego / además (0.07937ms)
✔ "y también" compound splits once (0.061436ms)
✔ determiner after connector is a plausible start (0.083558ms)
✔ quantity token after connector is a plausible start (0.254399ms)
✔ NEG: "con" is not a connector (0.071805ms)
✔ NEG: "de" is not a connector (0.059953ms)
✔ NEG: "después" followed by non-start does not split (0.066546ms)
✔ NEG: decimal comma does not split connector phase (0.071214ms)
✔ NEG: short stopword after "y" does not split (0.081304ms)
✔ connectors apply inside marker segments too (0.076705ms)
✔ inline markers: trailing connector on a segment is cleaned up (0.061466ms)
✔ quantity: digit + measure unit + "de" + product (0.073308ms)
✔ quantity: number word "medio" → 0.5 (0.037951ms)
✔ quantity: "por dos" multiplier — no unit (0.033864ms)
✔ quantity: "x2" multiplier — no unit (0.030227ms)
✔ quantity: "una docena" container stays as unit (0.034665ms)
✔ quantity: Spanish number words normalized to digits (0.037311ms)
✔ quantity: "un par de" → 2 (multiplier, no unit) (0.035016ms)
✔ quantity: de-contraction "del" stripped (0.039535ms)
✔ quantity: unrecognized measure unit (horas) parsed (0.059703ms)
✔ quantity: items without a quantity keep label===text, no qty/unit (0.11147ms)
✔ quantity: dangling quantity (no product) keeps raw phrase as label (0.106721ms)
✔ quantity: duplicate labels with matching unit merge (sum qty, keep raw text) (0.092975ms)
✔ quantity: duplicate labels with mismatched/missing unit kept separate (0.107833ms)
✔ quantity: non-adjacent duplicates merge across interleaved items (0.139513ms)
✔ drops silence and short Whisper hallucination fragments (1.164654ms)
✔ keeps plausible segments and attributes survivors to source timestamps (0.450859ms)
✔ drops low-confidence segments when confidence is available (0.316997ms)
✔ falls back to transcript text when Whisper has no segment metadata (0.104517ms)
✔ retains long unscored hallucination text because lexical guessing is out of scope (0.115657ms)
✔ worker sends filtered transcript results and keeps chunk confidence/timestamps (1.353751ms)
✔ silence with no decoded words produces the explicit empty state (0.11167ms)
✔ an empty audio buffer produces an empty result instead of a processing error (0.779579ms)
ℹ tests 61
ℹ suites 3
ℹ pass 61
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 99.238589 — 62 tests passed, 0 failed. Fresh tests run on reviewed worktree.
