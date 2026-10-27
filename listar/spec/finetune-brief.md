# Prompt: investigate & design the listar smart-mode fine-tune

Read `listar/spec/functionality.md` (§Item Splitter, §Smart Mode, §Verification) first.

Design (don't implement) a fine-tune of a tiny text-to-text model (~100–400M:
SmolLM/mT5/Qwen-class) mapping Spanish shopping-transcripts → flat item lines
(`label|qty|unit;;…`). Constraints & deliverables:

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
