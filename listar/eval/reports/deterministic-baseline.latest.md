# Listar contextual analyzer: deterministic baseline

Generated 2026-11-01T00:23:31.538Z. Evaluated 16 held-out fixtures; training and development partitions were checked for overlap but not evaluated.

**Provenance:** Hand-constructed regression fixtures from design/spec examples; not blinded and not transcribed speech.

| Expected intent | Cases | Exact | Accuracy | Safe action coverage | Review rate |
|---|---:|---:|---:|---:|---:|
| increment | 1 | 1 | 100.0% | 100.0% | 0.0% |
| set | 1 | 1 | 100.0% | 100.0% | 0.0% |
| add | 3 | 3 | 100.0% | 66.7% | 0.0% |
| remove | 2 | 2 | 100.0% | 50.0% | 0.0% |
| ambiguous | 1 | 1 | 100.0% | 0.0% | 0.0% |
| update-attribute | 3 | 3 | 100.0% | 0.0% | 0.0% |
| review | 7 | 7 | 100.0% | 0.0% | 100.0% |

## Safety and coverage

- Exact intent accuracy: 100.0%
- Target resolution accuracy: 100.0%
- Required-choice label accuracy: 100.0%
- Parsed quantity/unit accuracy: 100.0%/100.0%
- Price role accuracy: 100.0%
- Append-only routing accuracy: 100.0%
- Proposal coverage: 61.1%; safe action coverage: 27.8%
- Abstention/review rate: 38.9%; unresolved-choice proxy: 72.2%
- Unsafe candidate routes: 0; actual persistence commits in evaluation: 0
- Commit boundary: Every proposal still requires explicit UI confirmation before persistence.
- Source alignment/evidence preservation: 100.0%
- Local Node latency p50/p95: 0.112/2.423 ms; device latency not measured

## Model and data gates

No model was run or promoted. Model download size, real dictations and human correction effort are not measured. Confidence calibration: not measured; outputs are not probabilities. No model experiment justified or available; retain deterministic baseline and collect real dictations.

The held-out fixture set is synthetic and supports regression evaluation only. Collect labeled real dictations and measure browser/device behavior before any model promotion or release claim.
