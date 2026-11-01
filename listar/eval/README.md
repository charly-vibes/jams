# Contextual analyzer evaluation

Run `npm run eval:context` from `listar/` to validate the train/dev/held-out fixture separation, evaluate only the held-out partition, and regenerate `eval/reports/deterministic-baseline.latest.json` and `.md`.

The fixtures are hand-constructed regression cases from the contextual-command spec and safety contracts. They are not real speech, are not a blinded empirical benchmark, and some utterances also occur in deterministic unit tests. Train and dev are checked for overlap but are not evaluated or used to train a model.

The report measures intent, target, choice, quantity/unit, price-role, append-only routing, source-span/audio evidence preservation, candidate review/coverage and local Node latency. It does not execute persistence. `unsafeRouteCount` is a mismatch proxy against labels, not an observed false-commit rate; every proposal still requires explicit UI confirmation. Human correction effort, real dictation performance, browser/device latency, model download size and confidence calibration are not measured. No model runtime or model dependency is included.

Failure fixtures exercise the deterministic fallback when an optional parser attempt fails. A successful but unpromoted parser output is ignored; only a separately validated contextual adapter can be considered for promotion.
