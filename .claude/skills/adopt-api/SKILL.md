---
name: adopt-api
description: Re-skin this template from the example Todo API to your own API — pin your published contract package, replace the domain, rewrite the behavioural specs, register with the platform, and prove `task ci` green.
---

# Adopt a new API

The contract is the source of truth and it lives in **its own repo**, published as a package. So
the flow is: author + release the contract there → pin it here → regenerate → adapt the thin
hand-written layers → prove `task ci` is green → register with the platform.

Work in a branch. Make small commits per step. Never edit generated code by hand.

## 0. Prerequisites (other repos)

- The contract: run the `author-contract` skill in `aws.contract.template`, release it (first
  release = `1.0.0`; a replaced contract is a `feat!:` major). Note the package name.
- The platform: an environment of `aws.infra.template` deployed for each env you will target, and
  this service registered in its bootstrap `services` (done in step 6).

## 1. Pin the contract

- If the package name changed, replace `@datagriff/todo-api-contract` everywhere
  (`packages/api/package.json`, `scripts/lib/contract.mjs`, `.npmrc` scope, `renovate.json`,
  `Taskfile.yml`, docs); else just `task contract:bump VERSION=<x.y.z>`.
- `pnpm install` needs registry access (`~/.npmrc` PAT with `read:packages`). While the contract is
  unreleased, `task contract:link` against a built sibling checkout keeps you moving.

## 2. Regenerate

```bash
task gen
```

This rewrites `infra/terraform/modules/api-gateway/openapi.gateway.yaml`. Commit it.

## 3. Rename the service

Pick a new `service_name` and thread it through:

- `infra/terraform/stack/variables.tf` default and each `infra/terraform/envs/*/variables.tf` +
  `terraform.tfvars` (also `platform_name` if the platform was re-skinned).
- `package.json` name/description; root `README.md` title.
- `POWERTOOLS_SERVICE_NAME` flows from `service_name` automatically.

## 4. Replace the domain

The Todo domain is intentionally thin — mirror it for your resource(s):

- `packages/api/src/db/migrations/` — add a new migration for your schema (forward-only; do not
  edit the shipped one once applied). Multi-tenant tables keep `tenant_id` + `user_sub`. The test
  helper (`test/helpers/db.ts`) applies every migration with the real runner.
- `packages/api/src/repo/` — queries, all scoped by the token's tenant/user (never trust input).
- `packages/api/src/domain/` — business rules.
- `packages/api/src/router/index.ts` — map each `operationId`/route to a handler; validate bodies
  with the package's `schemas.*` and path/query params with a local zod check. The unit test
  `test/unit/routes-contract.test.ts` fails until the `routes` table matches the installed
  contract exactly.
- `local/server.ts` — the `ROUTES` table mirrors the contract's paths for `task serve`.
- `scripts/mint-token.mjs` — if your custom claims differ (they are the platform's trigger's),
  update the stub token's claims; `auth/claims.ts` reads them.
- `packages/api/src/db/queries/*.sql` — replace the example queries with useful ones.

## 5. Rewrite the behavioural specs (= acceptance criteria)

- `packages/api/test/features/*.feature` — your acceptance criteria as Gherkin; update `steps/`.
  Each scenario starts from an empty table, so assert exact counts.
- Update unit + integration tests. Keep the tenant-isolation scenarios (same user / other tenant
  AND same tenant / other user).
- `packages/api/test/contract/sdk-consumer.ts` is hand-written against the Todo operations:
  rewrite it for yours (create → get → list → update → delete → error paths, each response parsed
  with the package's zod). `collections/gateway.http` (hand-written smoke) rarely needs changes.

## 6. Register with the platform

In `aws.infra.template`: add `{ name = "<service_name>", github_repository = "<owner>/<repo>" }` to
`services`, re-run its bootstrap, and put `service_deploy_role_arns["<service_name>"][env]` into
this repo's GitHub Environments as `AWS_DEPLOY_ROLE_ARN` (see `docs/operations`). Flip
`enable_waf` / `custom_domain_enabled` per env only where the platform has the feature on.

## 7. Prove it

```bash
task ci             # lint, typecheck, gen-drift, unit, integration, BDD, contract, tf validate/test/scan
task test:contract  # just the contract layer: Schemathesis + published client + .http replay
task test:fuzz      # optional: property fuzzing against a deployed stage
```

`task ci` needs Docker (testcontainers). Without it, run `task check`, `task build` and
`task tf:validate`, and let CI run the container-backed layers.

Iterate until green. Then update `docs/` (tutorial backlog, operations) to describe the new domain,
open a draft PR, and hand back.

## Checklist

- [ ] contract released; `@datagriff/<package>` pinned; `pnpm install` resolves it
- [ ] `task gen` run; `openapi.gateway.yaml` committed
- [ ] `service_name` (and `platform_name`) renamed everywhere
- [ ] migrations, repo, domain, router replaced (+ `local/server.ts` ROUTES, `mint-token.mjs` claims)
- [ ] BDD features rewritten as the new acceptance criteria
- [ ] `test/contract/sdk-consumer.ts` rewritten for the new resources
- [ ] `infra/terraform/stack/tests/*.tftest.hcl` still pass (`task tf:test`)
- [ ] registered in the platform bootstrap; `AWS_DEPLOY_ROLE_ARN` wired per environment
- [ ] `task ci` green
- [ ] docs updated
