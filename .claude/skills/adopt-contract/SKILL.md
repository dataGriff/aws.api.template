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
- `packages/api/src/repo/` — queries, all scoped by the token's tenant/user (never trust client input).
- `packages/api/src/domain/` — business rules.
- `packages/api/src/router/index.ts` — map each `operationId`/route to a handler; validate bodies with
  the generated `schemas.*` and path params with a local zod check.
- `packages/api/src/db/queries/*.sql` — replace the example queries with useful ones for your data.

## 5. Rewrite the behavioural specs (= acceptance criteria)

- `packages/api/test/features/*.feature` — express your acceptance criteria as Gherkin scenarios; they
  ARE the tests. Update `steps/`.
- Update unit + integration + contract tests to your resources. Keep a tenant-isolation scenario.

## 6. Adapt auth claims if needed

- If your model needs different custom claims, edit `packages/cognito-pretoken/src/handler.ts` and the
  Cognito custom attribute in `infra/terraform/modules/cognito/main.tf`, plus `auth/claims.ts`.

## 7. Prove it

```bash
task ci          # full gate: lint, typecheck, gen-drift, unit, integration, BDD, contract, tf validate/scan
task test:fuzz   # optional: property fuzzing once a server/env is available
```

Iterate until green. Then update `docs/` (tutorial backlog, consumer guide) to describe the new domain,
open a draft PR, and hand back.

## Checklist

- [ ] `api/openapi.yaml` replaced, `task spec:lint` clean (snake_case enforced)
- [ ] `task gen` run; generated artifacts committed
- [ ] `service_name` renamed everywhere
- [ ] migrations, repo, domain, router replaced
- [ ] BDD features rewritten as the new acceptance criteria
- [ ] custom claims adjusted if required
- [ ] `task ci` green
- [ ] docs updated
