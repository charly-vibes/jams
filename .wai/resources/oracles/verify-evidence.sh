#!/usr/bin/env bash
set -euo pipefail

artifact_path="${1:-}"

# Verifier evidence contract (wai-px4g, R3 of harden-orchestration-gates).
#
# A verify review artifact may record CONFIRM only when it cites the
# artifacts it read (>=1 .wai/ artifact path) and includes fresh test-run
# output. Evidence gaps must be recorded as REVIEW_REQUIRED instead, and a
# single-model degradation is always REVIEW_REQUIRED — REVIEW_REQUIRED is
# therefore always a passing, non-blocking verdict here.
#
# Scope: one invocation per artifact (`verify-evidence.sh <artifact-path>`).

if [[ -z "$artifact_path" ]]; then
  echo "verify-evidence oracle requires an artifact path" >&2
  exit 1
fi

if [[ ! -f "$artifact_path" ]]; then
  echo "artifact not found: $artifact_path" >&2
  exit 1
fi

# Honest no-evidence (or single-model degradation) is always valid.
# Word-boundary match: prose like "awaiting confirmation" must not read as
# a CONFIRM verdict (RO5U pass-1 medium finding).
if grep -Eqi '\bREVIEW_REQUIRED\b' "$artifact_path"; then
  exit 0
fi

# Only a CONFIRM verdict is subject to the evidence contract.
if ! grep -Eqi '\bCONFIRM\b' "$artifact_path"; then
  echo "Review artifact records neither CONFIRM nor REVIEW_REQUIRED — record an explicit verdict: $artifact_path" >&2
  exit 1
fi

# Evidence requirement 1: the artifact must cite at least one read artifact
# path under .wai/ (what the verifier actually inspected).
if ! grep -Eqi '\.wai/[a-z-]+/[^ )`]+\.md' "$artifact_path"; then
  echo "CONFIRM requires the review artifact to cite >=1 read artifact path (e.g. .wai/projects/<p>/research/...) — record the reads or record REVIEW_REQUIRED: $artifact_path" >&2
  exit 1
fi

# Evidence requirement 2: fresh test-run output (a real test invocation with
# its result, not a claim that tests pass).
# Accepted limitation (design.md Decision 3): the oracle checks that fresh
# test-run output is PRESENT — it cannot judge ok-vs-failed in pasted output;
# the read-only verifier cross-checks claims separately.
if ! grep -Eqi '(test result:|cargo test|cargo nextest|just test)' "$artifact_path"; then
  echo "CONFIRM requires fresh test-run output in the review artifact (paste the test command + result) — or record REVIEW_REQUIRED: $artifact_path" >&2
  exit 1
fi

exit 0
