#!/usr/bin/env bash
# Backward-compatibility gate for the API contract.
# Compares api/openapi.yaml with the version on the base branch (the PR target
# in GitHub Actions, origin/main otherwise) and fails on breaking changes, so a
# field rename or a dropped response cannot merge just because every other
# layer regenerated cleanly against the NEW contract.
#
#   CONTRACT_BASE_REF=origin/release/1.x task contract:compat   # override the base
set -euo pipefail

CONTRACT="api/openapi.yaml"
BASE_REF="${CONTRACT_BASE_REF:-origin/${GITHUB_BASE_REF:-main}}"

# Best effort: CI checks out with full history; locally the ref may be stale.
git fetch -q origin "${BASE_REF#origin/}" 2>/dev/null || true

if ! git rev-parse -q --verify "${BASE_REF}^{commit}" >/dev/null 2>&1; then
  echo "contract:compat: base ref ${BASE_REF} not found — skipping (nothing to compare against)"
  exit 0
fi

# On the base branch itself (push to main) compare with the previous commit.
if [[ "$(git rev-parse HEAD)" == "$(git rev-parse "${BASE_REF}")" ]]; then
  BASE_REF="HEAD~1"
fi

if ! git cat-file -e "${BASE_REF}:${CONTRACT}" 2>/dev/null; then
  echo "contract:compat: no ${CONTRACT} at ${BASE_REF} — first version of the contract, nothing to compare"
  exit 0
fi

base_file="$(mktemp)"
trap 'rm -f "$base_file"' EXIT
git show "${BASE_REF}:${CONTRACT}" > "$base_file"

format="text"
[[ -n "${GITHUB_ACTIONS:-}" ]] && format="githubactions"

echo "contract:compat: ${BASE_REF}:${CONTRACT} -> ${CONTRACT}"
# ERR = breaking for existing clients (removed/renamed fields or operations,
# tightened request constraints, ...). WARN-level changes are reported but allowed.
oasdiff breaking "$base_file" "$CONTRACT" --fail-on ERR --format "$format"
