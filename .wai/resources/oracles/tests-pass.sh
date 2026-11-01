#!/usr/bin/env bash
set -euo pipefail

artifact_path="${1:-}"

# Lightweight evidence gate for pipelines that require the operator/agent to run
# tests manually and record the result in the step artifact.
#
# Pass when the artifact contains explicit verification language. This is not a
# replacement for actually running tests; it enforces that the step artifact
# records verification evidence before advancement.

if [[ -z "$artifact_path" ]]; then
  echo "tests-pass oracle requires an artifact path" >&2
  exit 1
fi

if [[ ! -f "$artifact_path" ]]; then
  echo "artifact not found: $artifact_path" >&2
  exit 1
fi

if grep -Eqi 'command=|commands run|verified:|tests pass|validation run|non-code|no code changes|full verification command' "$artifact_path"; then
  exit 0
fi

echo "Artifact lacks explicit verification evidence. Record commands run or note that the step was non-code work: $artifact_path" >&2
exit 1
