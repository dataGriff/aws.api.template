# Operations

Runbooks for wiring, deploying and operating the API.

## First-time wiring

This API deploys **onto a platform** (`aws.infra.template`) and **implements a published
contract** (`aws.contract.template`). Nothing here creates state backends, deploy roles or shared
infrastructure. In order:

1. **Release the contract.** Merge the contract repo to `main`; its Release workflow publishes
   `@datagriff/todo-api-contract` (first release `1.0.0`). Until a version exists, `pnpm install`
   here cannot resolve the dependency and CI fails at install — expected on a fresh adoption.
2. **Registry access.** In the contract package's settings, grant this repository _Actions access_
   (read), or set a `PACKAGES_READ_TOKEN` secret (a PAT with `read:packages`) — the workflows use
   `PACKAGES_READ_TOKEN || GITHUB_TOKEN`. Developers put
   `//npm.pkg.github.com/:_authToken=<PAT>` in their `~/.npmrc`.
3. **Lockfile.** Run `pnpm install` once with registry access and commit `pnpm-lock.yaml` (the
   entry for the contract package is the only change).
4. **Register the service on the platform.** Add `{ name = "<service_name>", github_repository =
"<owner>/<repo>" }` to `services` in the platform repo's `terraform/bootstrap/variables.tf` and
   re-run its `task tf:bootstrap`. That creates this API's per-env state backends
   (`<service_name>-tfstate-<env>-<account>` — the names `task tf:plan` derives) and deploy roles
   (`PowerUserAccess` + IAM scoped to `<service_name>-<env>-*` + read of `/platform/<env>/*`).
5. **GitHub Environments** `dev`, `staging`, `prod` in this repo (protection rules on
   staging/prod), each with the secret from the platform bootstrap output:

   | Platform `terraform output`                       | GitHub Environment setting | Type   |
   | ------------------------------------------------- | -------------------------- | ------ |
   | `service_deploy_role_arns["<service_name>"][env]` | `AWS_DEPLOY_ROLE_ARN`      | secret |
   | (optional) in-VPC DB URL                          | `MIGRATION_DATABASE_URL`   | secret |
   | (optional) region override                        | `AWS_REGION`               | var    |
   | (optional) registry PAT                           | `PACKAGES_READ_TOKEN`      | secret |

6. **Deploy the platform env first** — this stack's plan fails on a missing
   `/platform/<env>/interface/version` otherwise.

`service_name` (this repo's `terraform.tfvars`) and `platform_name` must match what the platform
registered / publishes under.

## Deploy

- The Deploy workflow runs only after the CI workflow has passed on `main` (`dev`), or on manual
  dispatch for `staging`/`prod` behind GitHub Environment protection rules. It assumes this
  service's per-environment OIDC role, renders the gateway spec + builds the Lambda, then runs
  `task tf:apply ENV=<env>` (plan to a file, apply that plan; the plan is kept as a workflow
  artifact), `task db:migrate` and, for dev/staging, `task smoke` (health + API Gateway behaviour
  checks). **Migrations run after the new code is live**, so every migration must be
  backward-compatible with the previous version (expand/contract). They are skipped with a warning
  when `MIGRATION_DATABASE_URL` is not set — the DB is private, so supply it via an in-VPC path.
- **Locally:** with AWS credentials, `task tf:plan ENV=dev` reads `service_name` from that env's
  `terraform.tfvars` and resolves the account id itself; `allowed_account_ids` hard-fails a wrong
  profile.
- **Prod guardrails (this stack):** an explicit `cors_origin`, `db_multi_az = true`,
  `deletion_protection = true` (`infra/terraform/stack/variables.tf`). Identity, WAF and alerting
  guardrails are the platform's.
- **Opt-ins that need the platform:** `enable_waf` attaches the stage to the platform's ACL
  (platform `enable_waf`); `custom_domain_enabled` creates `<service_name>.<base_domain>` with the
  platform's wildcard certificate (platform `dns_enabled`). The plan fails clearly if the platform
  does not publish them.

## Bumping the contract

```bash
task contract:bump VERSION=1.2.0   # pins the published version
task gen                           # re-renders the gateway spec
task ci                            # route table, handler, contract layer against the new version
```

Renovate opens a labelled `contract` PR for new versions (never auto-merged); a new **major** means
a breaking change to implement. While iterating on the contract locally, `task contract:link`
points `node_modules` at a built sibling checkout of `aws.contract.template`; `task contract:unlink`
returns to the registry version.

## Rollback, rotation, observability

- **Rollback**: migrations are forward-only — recover by **rolling forward**. Application rollback
  uses Lambda alias weighted routing to shift traffic back to the previous version.
- **Secret rotation**: DB credentials live in Secrets Manager (rotation is opt-in via
  `rotation_lambda_arn`); the Lambda re-reads the secret per new connection (cached 5 min), so a
  rotation needs no restart. Prefer RDS Proxy IAM auth (the default) to minimise standing secrets.
- **Observability**: CloudWatch dashboard, X-Ray traces, and structured JSON logs correlated by
  request id.

## Alerting

The `observability` module ships these CloudWatch alarms, all publishing to the **platform's**
alarm topic (`/platform/<env>/alarms/topic_arn`; subscriptions — email, Slack, PagerDuty — are
configured in the platform):

| Alarm                   | Source metric                                       | Default trigger  | Why                                          |
| ----------------------- | --------------------------------------------------- | ---------------- | -------------------------------------------- |
| `lambda-errors`         | `AWS/Lambda Errors`                                 | > 5 in 5 min     | Handler failures                             |
| `lambda-throttles`      | `AWS/Lambda Throttles`                              | ≥ 1 in 5 min     | Concurrency exhaustion                       |
| `api-5xx`               | `AWS/ApiGateway 5XXError`                           | > 5 in 5 min     | Server-side failures                         |
| `api-latency-p99`       | `AWS/ApiGateway Latency` p99                        | > 2000 ms        | Latency regressions                          |
| `db-connection-pinning` | `AWS/RDS DatabaseConnectionsCurrentlySessionPinned` | > 5 (proxy only) | RDS Proxy pinning silently disabling pooling |

Thresholds are tunable via the module variables (`error_threshold`, `latency_p99_ms`,
`pinning_threshold`). The dashboard is visible in the CloudWatch console under `<service>-<env>`.
