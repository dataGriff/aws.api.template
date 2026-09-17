# Testing

Each layer owns a distinct concern — no overlap.

| Layer | Tool | Owns | Runs |
| --- | --- | --- | --- |
| **Unit** | vitest | Pure logic: domain rules, claim extraction, error mapping, trigger logic | local + CI |
| **Integration** | vitest + testcontainers | Repo ↔ real Postgres, migrations | local + CI |
| **BDD / behavioural** | cucumber-js | Business scenarios = **acceptance criteria** (tenant isolation, lifecycle, authz) | local + CI |
| **Contract** | Prism + spectral | Known responses **conform to the schema** | local + CI |
| **Property / fuzz** | Schemathesis | Machine-generated inputs find 5xx / schema violations | nightly + on spec change |

**Boundaries:** BDD encodes human business rules; Contract checks example conformance; Schemathesis
explores the input space (given a valid token, scoped to conformance — it never asserts business rules).

_Expanded in Phase 8._
