# Testing

Each layer owns a distinct concern — no overlap.

| Layer                 | Tool                    | Owns                                                                                                                                                                                                                                                | Runs                   |
| --------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Unit**              | vitest                  | Pure logic: domain rules, claim extraction, error mapping, idempotency, request validation, router-vs-contract drift, trigger logic (every package's `test:unit`)                                                                                   | local + CI             |
| **Integration**       | vitest + testcontainers | Repo ↔ real Postgres; every migration applied by the real node-pg-migrate runner                                                                                                                                                                    | local + CI             |
| **BDD / behavioural** | cucumber-js             | Business scenarios = **acceptance criteria** (tenant isolation, lifecycle, authz)                                                                                                                                                                   | local + CI             |
| **Contract**          | vitest + generated zod  | Real handler responses **conform to the generated response schemas**                                                                                                                                                                                | local + CI             |
| **HTTP**              | Schemathesis + httpyac  | The handler **over real HTTP** via `local/server.ts` + throwaway Postgres: every operation fuzzed with `--checks all` (stateful via the contract's links) and the generated `.http` collection replayed; only contract-declared statuses, never 5xx | local + CI (Docker)    |
| **Property / fuzz**   | Schemathesis            | Machine-generated inputs against a **deployed stage** (API Gateway in front)                                                                                                                                                                        | nightly + after deploy |

**Boundaries:** BDD encodes human business rules; Contract checks example conformance; Schemathesis
explores the input space (given a valid token, scoped to conformance — it never asserts business rules).

**HTTP layer boundary.** `task test:http` (`packages/api/test/http/run.ts`) starts Postgres 16 with
testcontainers, applies every migration with the real node-pg-migrate runner, starts `local/server.ts`
on a free loopback port with `APP_ENV=local`, waits for `GET /v1/health`, mints a stub token, runs
Schemathesis and httpyac, and tears everything down on exit. It exercises the handler **over HTTP**
but through the local stub authorizer, so it does **not** cover anything API Gateway does in front of
the Lambda: the Cognito authorizer, request validation, gateway error responses, CORS, throttling and
WAF. Schemathesis' `ignored_auth` probe is excluded for that reason (the stub accepts any well-formed
token). Those gateway behaviours are the job of the opt-in `fuzz.yml` run against a deployed stage.
Set `HTTP_TEST_DATABASE_URL` to point the layer at an existing empty Postgres instead of Docker.

**Docker:** the integration, BDD, contract and HTTP layers start Postgres with testcontainers and need a
Docker daemon. `task check` (pre-commit) runs without Docker; `task ci` (pre-push) does not.
Spectral/Redocly lint the contract itself in `task spec:lint`; Prism (in `local/docker-compose.yml`)
is a mock for consumers, not a test oracle.

## Reading results in CI

The CI workflow runs the same sub-tasks as `task ci`, but as one named step per gate, so the Actions
UI shows which gate failed and each log is collapsible on its own. Task echoes every command it runs
(`task: [gate] tool ...`). vitest emits GitHub annotations for failing assertions automatically;
cucumber writes `packages/api/test-results/cucumber.ndjson`, Checkov writes a Markdown table of failed
checks to `test-results/`, and both are uploaded as the `test-results` artifact. Scanner findings fail
the job — there is no advisory-only output to scroll past.
