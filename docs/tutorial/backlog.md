# Delivery backlog

The build as an **epic → ticket** backlog. Each ticket uses the standard format
(**title · problem · acceptance criteria · effort**) and is sized to one reviewable, value-shipping PR.
Copy these into your tracker to replicate the build. Acceptance criteria are written to become the
executable [BDD scenarios](../testing/) where behavioural.

Effort key: **S** ≈ ½ day · **M** ≈ 1–2 days · **L** ≈ 3–5 days.

---

## Epic 1 — Foundations & DX

**T1.1 Pin the toolchain**
Problem: contributors, hooks, and CI drift on tool versions.
Acceptance: `.mise.toml` pins node/pnpm/terraform/task/scanners; `mise install` yields identical
versions locally and in CI. Effort: **S**

**T1.2 Single command source (Taskfile) + git hooks**
Problem: the same checks are re-implemented across laptops, hooks, and CI.
Acceptance: every check is a `task`; `lefthook` runs `task check` pre-commit and `task ci` pre-push;
CI calls only `task`. Effort: **M**

**T1.3 Docs skeleton + light AGENTS.md**
Problem: newcomers and agents need a map without a monolithic README.
Acceptance: `docs/` fan-out exists; `AGENTS.md` is light and points into `docs/`; `CLAUDE.md`
references `@AGENTS.md`. Effort: **S**

## Epic 2 — Contract & codegen

**T2.1 Author the OpenAPI contract**
Problem: without a single source of truth, server/client/docs drift.
Acceptance: `api/openapi.yaml` defines the API with `lower_snake_case`, RFC 7807 errors, cursor
pagination, idempotency, `/v1`, and security schemes; `task spec:lint` is clean and rejects camelCase.
Effort: **M**

**T2.2 Generate code, SDK, mock, docs, .http**
Problem: hand-written types/clients rot.
Acceptance: `task gen` produces zod+types, the consumer SDK, the `.http` collection + env file, and the
Redocly reference; `task gen:check` fails on drift in CI. Effort: **M**

## Epic 3 — Lambda service

**T3.1 Handler, router, error contract**
Problem: need a validated request path that returns a consistent error shape.
Acceptance: middy handler + generated-route dispatch; unknown/invalid/unauthorized requests return
RFC 7807 `problem+json` with `x-request-id`. Effort: **M**

**T3.2 Tenant-scoped persistence**
Problem: multi-tenant data must never leak across tenants.
Acceptance: every query is scoped by the token's tenant + user; a user in another tenant gets 404;
keyset pagination returns a stable cursor. (BDD) Effort: **M**

**T3.3 Connection pooling + secrets + idempotency**
Problem: Lambda exhausts DB connections; creates must be safe to retry.
Acceptance: cached pool via RDS Proxy IAM auth or Secrets Manager; create is idempotent when a table is
configured; migrations run out-of-band. Effort: **M**

**T3.4 Cognito custom claims**
Problem: the API authorizes on claims that must exist on the token.
Acceptance: pre-token trigger adds `custom:tenant_id` + roles to the access token; unit-tested with
sample events. Effort: **S**

## Epic 4 — Terraform

**T4.1 Core stack**
Problem: the API needs reproducible infra.
Acceptance: modules for network, database, cognito, lambda, api-gateway (from the rendered contract),
observability compose into a `stack`; `dev/staging/prod` validate. Effort: **L**

**T4.2 Opt-in flags**
Problem: WAF, static IPs, custom DNS, and DB engine must be toggleable without forking.
Acceptance: `enable_waf`, `enable_rds_proxy`, `enable_egress_static_ip`, `enable_ingress_static_ip`,
`custom_domain_enabled`, `db_engine` flip cleanly; `terraform plan` clean; preconditions guard bad
combos. Effort: **M**

**T4.3 Remote state + alerting**
Problem: state must be shared and failures must page someone.
Acceptance: S3+DynamoDB backend bootstrap; SNS alarms (errors, 5xx, latency, throttles, RDS pinning)
with optional email + budget alarm. Effort: **M**

## Epic 5 — Tests

**T5.1 Unit + contract**
Acceptance: vitest covers domain, claims, error mapping, trigger; responses conform to generated
schemas. Effort: **M**

**T5.2 Integration + BDD**
Acceptance: testcontainers Postgres integration; cucumber-js scenarios (the acceptance criteria) pass.
Effort: **M**

**T5.3 Property fuzzing**
Acceptance: `task test:fuzz` runs Schemathesis against a running server with a token; no schema
violations. Effort: **S**

## Epic 6 — Local dev

**T6.1 Local stack + server**
Acceptance: `task up` starts Postgres/cognito-local/Prism; `task serve` runs the real handler; `task
token` makes `.http` requests runnable. Effort: **M**

**T6.2 SQL ergonomics**
Acceptance: `task db:query -- <name>` runs example queries; `task db:console` opens Harlequin. Effort:
**S**

## Epic 7 — CI/CD & extras

**T7.1 CI parity + security**
Acceptance: `ci.yml` runs `task ci`; `security.yml` runs scanners + SBOM. Effort: **M**

**T7.2 Deploy (OIDC) + release**
Acceptance: `deploy.yml` assumes an OIDC role, applies Terraform per env, migrates, smoke-tests;
`release.yml` versions, publishes SDK, deploys docs to Pages. Effort: **L**

## Epic 8 — Docs & reuse

**T8.1 Docs fan-out**
Acceptance: tutorial (this backlog), consumer guide, architecture, operations, security, testing,
local-dev are populated and linked from the README. Effort: **M**

**T8.2 adopt-contract skill**
Acceptance: `.claude/skills/adopt-contract` walks from Todo to a new contract and ends with `task ci`
green. Effort: **M**
