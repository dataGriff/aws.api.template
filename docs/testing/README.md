# Testing

Each layer owns a distinct concern — no overlap.

| Layer                 | Tool                    | Owns                                                                                                                                                              | Runs                     |
| --------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Unit**              | vitest                  | Pure logic: domain rules, claim extraction, error mapping, idempotency, request validation, router-vs-contract drift, trigger logic (every package's `test:unit`) | local + CI               |
| **Integration**       | vitest + testcontainers | Repo ↔ real Postgres; every migration applied by the real node-pg-migrate runner                                                                                  | local + CI               |
| **BDD / behavioural** | cucumber-js             | Business scenarios = **acceptance criteria** (tenant isolation, lifecycle, authz)                                                                                 | local + CI               |
| **Contract**          | vitest + generated zod  | Real handler responses **conform to the generated response schemas**                                                                                              | local + CI               |
| **Property / fuzz**   | Schemathesis            | Machine-generated inputs find 5xx / schema violations                                                                                                             | nightly + on spec change |

**Boundaries:** BDD encodes human business rules; Contract checks example conformance; Schemathesis
explores the input space (given a valid token, scoped to conformance — it never asserts business rules).

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
