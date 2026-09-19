---
name: adopt-contract
description: Re-skin this template from the example Todo API to a brand-new API defined by your own OpenAPI contract — regenerating code, tests, docs, and infra wiring, then proving it green.
---

# Adopt a new contract

Use this to turn the template's example **Todo** API into **your** API. The contract is the source of
truth, so the flow is: replace the contract → regenerate → adapt the thin hand-written layers → prove
`task ci` is green.

Work in a branch. Make small commits per step. Never edit generated code by hand.

## 1. Establish the new contract

- If the user gave you an OpenAPI file, replace `api/openapi.yaml` with it.
- If not, co-author it: keep the existing structure (RFC 7807 `problem` schema, cursor pagination,
  `Idempotency-Key` on creates, `/v1`, security schemes) and swap the domain schemas/paths.
- **Enforce the naming standard:** all schema properties, query/path params, and enum values must be
  `lower_snake_case` (Redocly fails otherwise). Run `task spec:lint` until clean.

## 2. Regenerate everything

```bash
task gen
```

This rewrites: `packages/contracts` (zod + types), `packages/sdk` (client), `collections/*.http`,
`docs/api-reference/`, and `infra/terraform/modules/api-gateway/openapi.gateway.yaml`. Commit the
regenerated artifacts.

## 3. Rename the service

Pick a new `service_name` and thread it through:

- `infra/terraform/stack/variables.tf` default and each `infra/terraform/envs/*/variables.tf` +
  `terraform.tfvars`.
- `package.json` name/description; root `README.md` title.
- `POWERTOOLS_SERVICE_NAME` flows from `service_name` automatically.

## 4. Replace the domain

The Todo domain is intentionally thin — mirror it for your resource(s):

- `packages/api/src/db/migrations/` — add a new migration for your schema (keep it forward-only; do
  not edit the shipped one once applied). Multi-tenant tables should keep `tenant_id` + `user_sub`.
  The test helper (`test/helpers/db.ts`) applies every migration with the real runner, so nothing
  else needs updating for tests to see the new schema.
- `packages/api/src/repo/` — queries, all scoped by the token's tenant/user (never trust client input).
- `packages/api/src/domain/` — business rules.
- `packages/api/src/router/index.ts` — map each `operationId`/route to a handler; validate bodies with
  the generated `schemas.*` and path/query params with a local zod check. The unit test
  `test/unit/routes-contract.test.ts` fails until the `routes` table matches the contract exactly.
- `local/server.ts` — the `ROUTES` table (regex → API Gateway resource template) mirrors the
  contract's paths for `task serve`; add one entry per path.
- `scripts/mint-token.mjs` — if your custom claims change, update the stub token's claims.
- `packages/api/src/db/queries/*.sql` — replace the example queries with useful ones for your data.

## 5. Rewrite the behavioural specs (= acceptance criteria)

- `packages/api/test/features/*.feature` — express your acceptance criteria as Gherkin scenarios; they
  ARE the tests. Update `steps/`.
- Update unit + integration + contract tests to your resources. Keep the tenant-isolation scenarios
  (same user / other tenant AND same tenant / other user).

## 6. Adapt auth claims if needed

- If your model needs different custom claims, edit `packages/cognito-pretoken/src/handler.ts` and the
  Cognito custom attribute in `infra/terraform/modules/cognito/main.tf`, plus `auth/claims.ts`.

## 7. Prove it

```bash
task ci             # full gate: lint, typecheck, contract compat, gen-drift, unit (all packages), integration, BDD, contract, tf validate/scan
task test:contract  # just the contract layer: Schemathesis + generated SDK + .http collection over real HTTP against local/server.ts
task contract:compat # breaking-change check of api/openapi.yaml vs the base branch (oasdiff)
task test:fuzz      # optional: property fuzzing against a deployed stage
```

The contract layer derives Schemathesis and the `.http` collection from the contract, so those need no
edits. The **SDK consumer walk** (`packages/api/test/contract/sdk-consumer.ts`) is hand-written against
the Todo operations: rewrite it for your resources (create → get → list → update → delete → error
paths, each response parsed with the generated zod). Two things keep the layer useful: declare `links`
from your create operation's 201 to the by-id operations (`$response.body#/<id>`), so Schemathesis
reaches their success paths; and keep every status your handler can return declared per operation,
because the layer fails on any undeclared status. Replacing the contract wholesale is a breaking change
by definition — run `CONTRACT_BASE_REF=HEAD task contract:compat` on the first commit, or accept the
failure on that one PR knowingly; after that the gate protects your consumers.

`task ci` needs Docker (testcontainers). Without it, run `task check` plus `task build` and
`task tf:validate`, and let CI run the container-backed layers.

Iterate until green. Then update `docs/` (tutorial backlog, consumer guide) to describe the new domain,
open a draft PR, and hand back.

## Checklist

- [ ] `api/openapi.yaml` replaced, `task spec:lint` clean (snake_case enforced)
- [ ] `task gen` run; generated artifacts committed
- [ ] `service_name` renamed everywhere
- [ ] migrations, repo, domain, router replaced (+ `local/server.ts` ROUTES, `scripts/mint-token.mjs` claims)
- [ ] BDD features rewritten as the new acceptance criteria
- [ ] custom claims adjusted if required
- [ ] `test/contract/sdk-consumer.ts` rewritten for the new resources
- [ ] `task test:contract` green (every returned status declared in the contract; create→by-id `links` present)
- [ ] `task contract:compat` outcome understood (a replaced contract IS breaking; later PRs are protected)
- [ ] `task ci` green
- [ ] docs updated
