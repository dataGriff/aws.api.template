#!/usr/bin/env bash
# Property-based fuzzing of the running API from the OpenAPI contract.
# Runs against a local server by default; point API_URL at a deployed stage in
# CI. A bearer token (API_TOKEN) is required for the authenticated operations —
# mint one with `task token` locally, or a Cognito test user in CI.
set -euo pipefail

SCHEMA="${SCHEMA:-api/openapi.yaml}"
API_URL="${API_URL:-http://localhost:3000/v1}"
MAX_EXAMPLES="${SCHEMATHESIS_EXAMPLES:-25}"

args=(run "$SCHEMA" --base-url "$API_URL" --checks all --hypothesis-max-examples "$MAX_EXAMPLES")

if [[ -n "${API_TOKEN:-}" ]]; then
  args+=(--header "Authorization: Bearer ${API_TOKEN}")
fi
if [[ -n "${API_KEY:-}" ]]; then
  args+=(--header "x-api-key: ${API_KEY}")
fi

# Do not echo the argument list: it carries the bearer token / API key.
echo "schemathesis run ${SCHEMA} --base-url ${API_URL} --checks all --hypothesis-max-examples ${MAX_EXAMPLES}${API_TOKEN:+ (with bearer token)}${API_KEY:+ (with api key)}"
exec schemathesis "${args[@]}"
