# Decision log

Short ADRs — the "why" behind the template's choices.

**ADR-1: Contract-first with a zod-emitting generator (Kubb).** The OpenAPI contract is the source of
truth. Types-only generators can't validate at runtime, so we generate zod schemas and validate in the
handler (defence-in-depth behind API Gateway's own request validation). Trade-off: an extra codegen
step, gated by `task gen:check`.

**ADR-2: REST API, not HTTP API.** Chosen for WAF support, gateway-level request validation from the
contract, and API keys + usage plans for a consumer program. Costs a little more per request than HTTP
API. Cognito authorizes via a user-pools authorizer.

**ADR-3: middy + a generated router, not the Powertools REST router.** The Powertools TypeScript event
handler is still experimental; routing lives behind our own interface so it can be swapped when that
GAs. Powertools is used for logging, tracing, metrics, parameters, and idempotency.

**ADR-4: Postgres via RDS Proxy, engine parameterised.** RDS Proxy pools connections for Lambda (IAM
auth, TLS). `db_engine` switches Aurora Serverless v2 ↔ a single RDS instance so cost/scale is a per-env
choice. Avoid connection pinning (no session state) or pooling silently degrades.

**ADR-5: `lower_snake_case` everywhere in the contract.** Enforced by Redocly. Codegen emits snake_case
directly, so there is no field remapping and the contract stays the single source of truth.

**ADR-6: Static IP and custom DNS are opt-in flags, default off.** Egress uses NAT + EIP; ingress uses
Global Accelerator (two static anycast IPs) in front of an internal NLB, because a REST API is
DNS-fronted and can't be given a fixed inbound IP directly. Both add cost, so they're off by default.

**ADR-7: Migrations are forward-only and run out-of-band.** Never in the request path. Rollback is
roll-forward plus Lambda alias weighted routing for the application layer.

**ADR-8: mise + Taskfile as the single source of tooling and commands.** Git hooks and CI invoke only
`task` targets after `mise install`, guaranteeing local == CI. This is the anti-drift backbone.

**ADR-9: Generated artifacts are committed and drift-gated.** Committing `contracts`, `sdk`,
`collections`, `docs/api-reference` and the rendered gateway spec makes contract changes visible in
PR diffs; CI regenerates and `git status --porcelain` on those paths (so new files count) blocks
staleness. The hand-written route table is held to the contract by a unit test.

**ADR-10: Tenant isolation lives in the repository layer, not Postgres RLS.** RLS would need
`SET app.tenant_id` per request, which pins RDS Proxy sessions and silently disables pooling (ADR-4).
Every query therefore binds `tenant_id AND user_sub` from validated token claims, and the BDD suite
asserts isolation on each axis independently so removing either predicate fails a test.

**ADR-11: Deploy only what CI validated.** The Deploy workflow is triggered by a successful CI run
(not by the push itself), applies a saved plan, and serialises per environment. Renovate never
auto-merges runtime dependencies because `main` deploys itself.
