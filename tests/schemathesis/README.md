# Schemathesis (property-based fuzzing)

Generates requests from `api/openapi.yaml` and asserts the running API never
violates its own contract (no unexpected 5xx, responses match declared schemas,
etc.). This layer explores the **input space** — it does not encode business
rules (that is the BDD layer's job).

## Run it

```bash
# Local: start the stack + server, mint a token, then fuzz.
task up
task serve &            # or run in another terminal
export API_TOKEN="$(task token -- --print)"
task test:fuzz
```

In CI it runs nightly and on contract changes against a deployed stage, with a
token minted from a Cognito test user (see `.github/workflows`).

## Tuning

- `SCHEMATHESIS_EXAMPLES` — examples per operation (default 25; raise for depth).
- `API_URL` — base URL (default `http://localhost:3000/v1`).
- `API_KEY` — sent as `x-api-key` when usage plans are enforced.

Keep it scoped to schema conformance. If an operation needs complex pre-existing
state, seed it first or exclude it rather than asserting business expectations
here.
