# Testing

Each layer owns a distinct concern — no overlap.

| Layer                 | Tool                                          | Owns                                                                                                                                                                                                                                                                                                                                                    | Runs                   |
| --------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Unit**              | vitest                                        | Pure logic: claims, cursor codec, domain rules, idempotency state machine (in-memory store), pool configuration (IAM token, secret refresh, TLS), the generators, trigger logic — every package's `test:unit`                                                                                                                                           | local + CI             |
| **Handler**           | vitest (middy in-process)                     | The full middleware stack with the repository mocked: validation 400s, problem+json shape, request-id, header bounds, NUL rejection                                                                                                                                                                                                                     | local + CI             |
| **Integration**       | vitest + testcontainers                       | Repo ↔ real Postgres (every migration via the real runner; dates, nulls, cursors, SQLSTATE); idempotency ↔ **DynamoDB Local** with the table schema Terraform declares                                                                                                                                                                                  | local + CI (Docker)    |
| **BDD / behavioural** | cucumber-js                                   | Business scenarios = **acceptance criteria** (tenant isolation, lifecycle, authz)                                                                                                                                                                                                                                                                       | local + CI             |
| **Contract**          | Schemathesis + the published client + httpyac | Over **real HTTP** via `local/server.ts` + throwaway Postgres, all from the **pinned `@datagriff/todo-api-contract`**: provider conformance (`--checks all`, stateful via the contract's links), consumer conformance (the published client through every operation, responses checked with the package's zod), the shipped `.http` collection replayed | local + CI (Docker)    |
| **Property / fuzz**   | Schemathesis                                  | Machine-generated inputs against a **deployed stage** (API Gateway in front)                                                                                                                                                                                                                                                                            | nightly + after deploy |

**Boundaries:** BDD encodes human business rules; Contract checks example conformance; Schemathesis
explores the input space (given a valid token, scoped to conformance — it never asserts business rules).

**Contract layer, in two parts — against the version the API pins.** (1) _Provider conformance_:
`task test:contract` (`packages/api/test/contract/run.ts`) starts Postgres 16 with testcontainers,
applies every migration with the real node-pg-migrate runner, starts `local/server.ts` on a free
loopback port with `APP_ENV=local`, waits for `GET /v1/health`, mints a stub token and runs
Schemathesis on the installed package's `openapi.yaml` with `--checks all`, following the
contract's `links` from create into the by-id operations. (2) _Consumer conformance_: the same run
drives the **published client** (the `@datagriff/todo-api-contract` version in
`packages/api/package.json`, exactly as a consumer installs it) through every operation and error
path via `createClient`/`ApiError`, checking each response with the package's zod schemas — both
halves of the contract must agree. The package's `.http` collection is replayed too (as shipped,
then with a real id). Backward compatibility of the contract itself (oasdiff) is the contract
repo's gate; here a **major** bump is the signal that the implementation must change.

**Boundary.** Parts 1 and 2 go through the local stub authorizer, so they do **not** cover anything
API Gateway does in front of the Lambda: the Cognito authorizer, request validation, gateway error
responses, CORS, throttling and WAF. Schemathesis' `ignored_auth` probe is excluded for that reason
(the stub accepts any well-formed token). Those gateway behaviours are the job of the opt-in
`fuzz.yml` run against a deployed stage. Set `HTTP_TEST_DATABASE_URL` to point the layer at an
existing empty Postgres instead of Docker. Consumer-driven tooling (Pact) or contract platforms
(Specmatic, Microcks) are not used: the contract is producer-owned and REST-only, and each function
they bundle — mocking (Prism), provider verification (Schemathesis), compatibility (oasdiff) — is
covered by a focused tool without a JVM in the toolchain.

**Infrastructure.** `task tf:test` runs `terraform test` on the stack with mocked providers and a
**mocked platform interface** (SSM parameters overridden per run, no credentials): the prod
guardrails must refuse a plan without an explicit CORS origin, Multi-AZ or deletion protection;
a plan against another platform `interface/version` must fail; a hardened prod plan must carry
Multi-AZ, deletion protection, `rds.force_ssl`, the WAF association and the
`<service>.<base_domain>` hostname; dev must keep Performance Insights off on `db.t4g.micro`, split
the platform's subnet list, and keep VPC-internal egress unless the platform reports NAT. It sits
in `task tf:validate` next to fmt/validate/tflint. Identity, WAF and alerting guardrails are tested
in the platform repo.

**Post-deploy.** `task smoke ENV=<env> URL=<invoke url>` (run by the deploy workflow for dev/staging)
replays the package's `health.http` and the hand-written `collections/gateway.http` against the real
stage: the authorizer's 401 as problem+json with CORS headers, an invalid token, an unknown route and
the CORS preflight — the API Gateway behaviours no local layer can produce. It needs no Cognito user.

**Docker:** the integration, BDD and contract layers start Postgres with testcontainers and need a
Docker daemon. `task check` (pre-commit) runs without Docker; `task ci` (pre-push) does not.
Linting the contract itself (Redocly), its package test and the Prism self-consistency check live
in the contract repo.

## Reading results in CI

The CI workflow runs the same sub-tasks as `task ci`, but as one named step per gate, so the Actions
UI shows which gate failed and each log is collapsible on its own. Task echoes every command it runs
(`task: [gate] tool ...`). vitest emits GitHub annotations for failing assertions automatically and writes junit reports
(`packages/api/test-results/vitest-*.xml`); cucumber writes `cucumber.ndjson` next to them, Checkov a
Markdown table of failed checks to `test-results/`, and all are uploaded as the `test-results` artifact. Scanner findings fail
the job — there is no advisory-only output to scroll past.
