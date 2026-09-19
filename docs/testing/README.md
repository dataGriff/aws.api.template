# Testing

Each layer owns a distinct concern — no overlap.

| Layer                 | Tool                                             | Owns                                                                                                                                                                                                                                                                                                                                                 | Runs                                        |
| --------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Unit**              | vitest                                           | Pure logic: domain rules, claim extraction, error mapping, idempotency, request validation, router-vs-contract drift, trigger logic (every package's `test:unit`)                                                                                                                                                                                    | local + CI                                  |
| **Integration**       | vitest + testcontainers                          | Repo ↔ real Postgres; every migration applied by the real node-pg-migrate runner                                                                                                                                                                                                                                                                     | local + CI                                  |
| **BDD / behavioural** | cucumber-js                                      | Business scenarios = **acceptance criteria** (tenant isolation, lifecycle, authz)                                                                                                                                                                                                                                                                    | local + CI                                  |
| **Contract**          | Schemathesis + generated SDK + httpyac + oasdiff | Over **real HTTP** via `local/server.ts` + throwaway Postgres: provider conformance (`--checks all`, stateful via the contract's links), consumer conformance (the generated SDK through every operation, responses checked with the generated zod), the `.http` collection replayed; plus a Docker-free **breaking-change gate** vs the base branch | local + CI (Docker); compat in `task check` |
| **Property / fuzz**   | Schemathesis                                     | Machine-generated inputs against a **deployed stage** (API Gateway in front)                                                                                                                                                                                                                                                                         | nightly + after deploy                      |

**Boundaries:** BDD encodes human business rules; Contract checks example conformance; Schemathesis
explores the input space (given a valid token, scoped to conformance — it never asserts business rules).

**Contract layer, in three parts.** (1) _Provider conformance_: `task test:contract`
(`packages/api/test/contract/run.ts`) starts Postgres 16 with testcontainers, applies every migration
with the real node-pg-migrate runner, starts `local/server.ts` on a free loopback port with
`APP_ENV=local`, waits for `GET /v1/health`, mints a stub token and runs Schemathesis with
`--checks all`, following the contract's `links` from create into the by-id operations.
(2) _Consumer conformance_: the same run drives the **generated SDK** (its built `dist`, exactly as a
consumer installs it) through every operation and error path via `createClient`/`ApiError`, checking
each response with the generated zod schemas — both halves of the contract must agree. The generated
`.http` collection is replayed too (as generated, then with a real id). (3) _Backward compatibility_:
`task contract:compat` (in `task check`, no Docker) runs `oasdiff breaking` against the contract on
the base branch, so a renamed field or a dropped response fails the PR instead of regenerating
cleanly against itself.

**Boundary.** Parts 1 and 2 go through the local stub authorizer, so they do **not** cover anything
API Gateway does in front of the Lambda: the Cognito authorizer, request validation, gateway error
responses, CORS, throttling and WAF. Schemathesis' `ignored_auth` probe is excluded for that reason
(the stub accepts any well-formed token). Those gateway behaviours are the job of the opt-in
`fuzz.yml` run against a deployed stage. Set `HTTP_TEST_DATABASE_URL` to point the layer at an
existing empty Postgres instead of Docker. Consumer-driven tooling (Pact) or contract platforms
(Specmatic, Microcks) are not used: the contract is producer-owned and REST-only, and each function
they bundle — mocking (Prism), provider verification (Schemathesis), compatibility (oasdiff) — is
covered by a focused tool without a JVM in the toolchain.

**Docker:** the integration, BDD and contract layers start Postgres with testcontainers and need a
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
