# Testing

Each layer owns a distinct concern — no overlap.

| Layer                 | Tool                                             | Owns                                                                                                                                                                                                                                                                                                                                                                                                | Runs                                        |
| --------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Unit**              | vitest                                           | Pure logic: claims, cursor codec, domain rules, idempotency state machine (in-memory store), pool configuration (IAM token, secret refresh, TLS), the generators (gateway spec, `.http`, **ODCS → zod**), the **CSV parser/validator** (every rule of the file contract), the ODCS ↔ OpenAPI drift check, trigger logic — every package's `test:unit`                                               | local + CI                                  |
| **Handler**           | vitest (middy in-process)                        | The full middleware stack with the repositories mocked: validation 400s, problem+json shape, request-id, header bounds, NUL rejection, the pre-signed POST policy `POST /imports` mints, and the **ingest's decision logic** (trust model, atomicity, idempotency, quarantine) with S3 and Postgres mocked                                                                                          | local + CI                                  |
| **Integration**       | vitest + testcontainers                          | Repo ↔ real Postgres (every migration via the real runner; dates, nulls, cursors, SQLSTATE); idempotency ↔ **DynamoDB Local** with the table schema Terraform declares; the **import pipeline** end to end ↔ **moto** (S3 + SQS + KMS): pre-signed upload, S3's own notification, the ingest fed from the queue, quarantine objects and report                                                      | local + CI (Docker)                         |
| **BDD / behavioural** | cucumber-js                                      | Business scenarios = **acceptance criteria** (tenant isolation, lifecycle, authz, file import: all-or-nothing, quarantine, owner scoping)                                                                                                                                                                                                                                                           | local + CI (Docker)                         |
| **Contract**          | Schemathesis + generated SDK + httpyac + oasdiff | Over **real HTTP** via `local/server.ts` + throwaway Postgres + moto: provider conformance (`--checks all`, stateful via the contract's links), consumer conformance (the generated SDK through every operation incl. a real CSV upload and its outcome, responses checked with the generated zod), the `.http` collection replayed; plus a Docker-free **breaking-change gate** vs the base branch | local + CI (Docker); compat in `task check` |
| **Data contract**     | datacontract-cli                                 | The **ODCS 3.2 file contract** itself (`api/todo-import.odcs.yaml`): lint, the valid example file must pass every schema/quality check, the invalid example must fail                                                                                                                                                                                                                               | local + CI (no Docker, in `task check`)     |
| **Property / fuzz**   | Schemathesis                                     | Machine-generated inputs against a **deployed stage** (API Gateway in front)                                                                                                                                                                                                                                                                                                                        | nightly + after deploy                      |

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

**Two contracts, one domain.** The CSV import has its own machine-readable contract,
`api/todo-import.odcs.yaml` (Open Data Contract Standard 3.2). It is tested at three levels: (1)
`task contract:odcs` (in `task check`) lints it with **datacontract-cli** and runs the tool's own
schema/quality checks against `api/examples/todo-import.valid.csv` (must pass) and
`todo-import.invalid.csv` (must fail); (2) `task gen` renders it into the runtime row validator
(`packages/contracts/src/generated/odcs/`) and the unit tests pin every rule of that validator plus
the generator's output (drift-gated like every generated artifact); (3) a unit test asserts the
ODCS columns carry exactly the constraints of `todo_create` in `api/openapi.yaml`, so the file and
HTTP interfaces cannot accept different todos. Rows then flow through the same generated
`todo_create` schema and the same `createTodo` domain function the API uses — there is no second
implementation of "what a valid todo is".

**Import pipeline over real stores.** `moto` (Apache-2.0, `motoserver/moto`) stands in for S3, SQS
and KMS in the integration, BDD and contract layers, started with testcontainers (or reused via
`TEST_AWS_ENDPOINT_URL`, like `TEST_DATABASE_URL`). The tests upload through the pre-signed POST the
API minted, let S3 deliver its notification into the queue and feed the **real ingest handler**
from that queue (`local/import-queue.ts`, the same code the local worker runs), then assert on the
todos, the import status, the quarantined object and its report. What moto does **not** enforce:
the signed POST policy's conditions (size range, content type, SSE headers) and the bucket policy
— those are S3 behaviours; the handler tests assert the policy the API mints, `terraform test`
asserts the bucket configuration, and the deployed smoke run exercises the real thing.

**Infrastructure.** `task tf:test` runs `terraform test` on the stack with mocked providers (no
credentials): the prod guardrails must refuse a plan without an alarm email, an explicit CORS
origin, https callbacks, Multi-AZ, deletion protection or with the password-auth client; a hardened
prod plan must carry Multi-AZ, deletion protection, `rds.force_ssl`, Cognito deletion protection and
the WAF; dev must keep Performance Insights off on `db.t4g.micro` and VPC-internal egress unless the
static-egress opt-in is set; the import bucket must block public access, be versioned and
KMS-encrypted, expire uploads and quarantine by lifecycle, notify only for `uploads/`, dead-letter
after three attempts and run its ingest inside the VPC with bounded concurrency. It sits in
`task tf:validate` next to fmt/validate/tflint.

**Post-deploy.** `task smoke ENV=<env> URL=<invoke url>` (run by the deploy workflow for dev/staging)
replays `collections/health.http` and the hand-written `collections/gateway.http` against the real
stage: the authorizer's 401 as problem+json with CORS headers, an invalid token, an unknown route and
the CORS preflight — the API Gateway behaviours no local layer can produce. It needs no Cognito user.

**Docker:** the integration, BDD and contract layers start Postgres and moto with testcontainers and
need a Docker daemon. `task check` (pre-commit) runs without Docker; `task ci` (pre-push) does not.
Spectral/Redocly lint the contract itself in `task spec:lint`; Prism (in `local/docker-compose.yml`)
is a mock for consumers, not a test oracle.

## Reading results in CI

The CI workflow runs the same sub-tasks as `task ci`, but as one named step per gate, so the Actions
UI shows which gate failed and each log is collapsible on its own. Task echoes every command it runs
(`task: [gate] tool ...`). vitest emits GitHub annotations for failing assertions automatically and writes junit reports
(`packages/api/test-results/vitest-*.xml`); cucumber writes `cucumber.ndjson` next to them, Checkov a
Markdown table of failed checks to `test-results/`, and all are uploaded as the `test-results` artifact. Scanner findings fail
the job — there is no advisory-only output to scroll past.
