# Prompt: investigate & design the listar smart-mode fine-tune

Read `listar/spec/functionality.md` (§Item Splitter, §Smart Mode, §Verification) and
[the contextual-command design](contextual-commands.md) first.

This is a conditional research brief, not a decision to train a model next.
Evaluate deterministic parsing and active-list context first (Beads `jams-w4m`);
use measured failure cases to justify any model experiment. A splitter-model
benchmark alone does not establish contextual command safety or calibrated routing.

Design (don't implement) a fine-tune of a tiny text-to-text model (~100–400M:
SmolLM/mT5/Qwen-class) mapping Spanish shopping-transcripts → flat item lines
(`label|qty|unit;;…`) for append-only item extraction. This output cannot
represent command intents, target IDs, assertion IDs or ambiguity. Contextual
model proposals need a separate `analyze()` adapter and evaluation gate per
[the integration design](contextual-commands.md#separate-item-extraction-from-command-proposals).
Preserve raw source evidence through verified alignment or fall back to the
heuristic/review path; never silently turn a failed contextual command into an
append. Constraints & deliverables:

1. **Corpus plan** — how to synthesize ≥10k transcript→items pairs from
   templates + noise (connectors, disfluencies, number words, dangling
   quantities, negative fixtures). No audio, no TTS.
2. **Training env** — my machine is CPU-only, so training must run on a cheap
   cloud GPU. Evaluate Baseten vs Colab/Modal/RunPod/Lambda for a one-shot
   fine-tune of this size: est. cost, GPU-hours, setup friction. Recommend one.
3. **Local inference** — export → ONNX → quantize (q4) → run on CPU locally and
   in transformers.js (browser). Confirm feasibility + est. size/latency.
4. **Output format** — flat line format parsed by a trivial reader (spec §Smart
   Mode); greedy decoding; no JSON grammar tooling.
5. **Eval** — benchmark vs the heuristic splitter on the golden corpus
   (`listar/test/fixtures/`) + negatives; promotion gate per spec.

Return: a ≤1-page design with provider pick, cost estimate, corpus generator
sketch, and a go/no-go recommendation.
