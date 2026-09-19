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

## Epic 2 — Consume the contract package

**T2.1 Pin the contract**
Problem: the API's surface must be the published contract, not a copy of it.
Acceptance: `packages/api` depends on `@datagriff/todo-api-contract` (GitHub Packages, `.npmrc`
scope mapping, registry auth in CI); `scripts/lib/contract.mjs` resolves the installed spec;
`task contract:bump` / `contract:link` exist. Effort: **S**

**T2.2 Render the gateway spec**
Problem: API Gateway needs AWS extensions the portable contract must not carry.
Acceptance: `task gen` renders `openapi.gateway.yaml` from the installed contract (integrations,
validators, Cognito authorizer, CORS, problem+json gateway responses); `task gen:check` fails on
drift in CI; the route table is held to the contract by a unit test. Effort: **M**

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

**T3.4 Claims from the platform pool**
Problem: the API authorizes on claims the platform's pre-token trigger puts on the token.
Acceptance: `auth/claims.ts` reads `custom:tenant_id` / roles from the authorizer context;
unit-tested with sample events (the trigger itself is the platform's). Effort: **S**

## Epic 4 — Terraform: the API stack on the platform

**T4.1 Platform module**
Problem: the stack needs the platform's VPC, keys, pool, topic without coupling to its state.
Acceptance: `modules/platform` reads `/platform/<env>/…` SSM parameters (required + flag-gated
optional), unwraps them, and the stack refuses another `interface/version`. Effort: **M**

**T4.2 Core stack**
Problem: the API needs reproducible infra of its own.
Acceptance: database, rds-proxy, secrets, lambda-api, api-gateway (from the rendered contract),
observability (alarms into the platform topic) compose into a `stack`; `dev/staging/prod`
validate; the deploy role and state backend come from the platform bootstrap. Effort: **L**

**T4.3 Opt-in flags**
Problem: WAF attachment, a hostname and the DB engine must be toggleable without forking.
Acceptance: `enable_waf` (platform ACL association), `custom_domain_enabled`
(`<service>.<base_domain>` with the platform certificate), `enable_rds_proxy`, `db_engine` flip
cleanly; missing platform features fail at plan. Effort: **M**

## Epic 5 — Tests

**T5.1 Unit + contract**
Acceptance: vitest covers domain, claims, error mapping, the gateway renderer; the contract layer
runs Schemathesis, the published client and the shipped collection against the local server from
the pinned package. Effort: **M**

**T5.2 Integration + BDD**
Acceptance: testcontainers Postgres integration; cucumber-js scenarios (the acceptance criteria) pass.
Effort: **M**

**T5.3 Property fuzzing**
Acceptance: `task test:fuzz` runs Schemathesis against a running server with a token; no schema
violations. Effort: **S**

## Epic 6 — Local dev

**T6.1 Local stack + server**
Acceptance: `task up` starts Postgres/cognito-local; `task serve` runs the real handler; `task http`
fires the package's `.http` collection with a stub token. Effort: **M**

**T6.2 SQL ergonomics**
Acceptance: `task db:query -- <name>` runs example queries; `task db:console` opens Harlequin. Effort:
**S**

## Epic 7 — CI/CD & extras

**T7.1 CI parity + security**
Acceptance: `ci.yml` runs `task ci`; `security.yml` runs scanners + SBOM. Effort: **M**

**T7.2 Deploy (OIDC) + release**
Acceptance: `deploy.yml` assumes the service's platform-issued OIDC role, applies Terraform per
env, migrates, smoke-tests; `release.yml` versions and tags. Effort: **L**

## Epic 8 — Docs & reuse

**T8.1 Docs fan-out**
Acceptance: tutorial (this backlog), consumer guide, architecture, operations, security, testing,
local-dev are populated and linked from the README. Effort: **M**

**T8.2 adopt-api skill**
Acceptance: `.claude/skills/adopt-api` walks from Todo to your own (published) contract and ends
with `task ci` green. Effort: **M**
