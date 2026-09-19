# Operations

Runbooks for deploying and operating the API.

## First-time setup (bootstrap)

Run this **once per AWS account**, before any deploy. It creates the remote Terraform state backend
(S3 + DynamoDB + KMS), the GitHub OIDC provider, and one deploy role per environment. It uses a
**local** backend (it's the chicken-and-egg step that creates the backend the envs then use), so its
state lives on disk in `infra/terraform/bootstrap` — you only re-run it when the backend or the deploy
roles change.

- **Prerequisites**:
  - Local **admin** AWS credentials for the target account (the deploy roles it creates get broad
    rights — see `infra/terraform/bootstrap/main.tf`).
  - The three GitHub Environments (`dev`, `staging`, `prod`) created in repo **Settings → Environments**,
    with protection rules / required reviewers on `staging` and `prod` (that's where the deploy gating
    lives).
  - A **globally-unique** S3 bucket name for Terraform state.
- **Run it**:

  ```sh
  task tf:bootstrap STATE_BUCKET=<globally-unique-bucket> GITHUB_REPOSITORY=<owner/repo>
  ```

  `GITHUB_REPOSITORY` **must** be your repo — the OIDC trust is scoped to
  `repo:<owner>/<repo>:environment:<env>`, so the wrong value means every deploy silently fails to
  assume the role.
- **Wire the printed outputs into each GitHub Environment**:

  | `terraform output`         | GitHub Environment setting | Type   |
  | -------------------------- | -------------------------- | ------ |
  | `deploy_role_arns[<env>]`  | `AWS_DEPLOY_ROLE_ARN`      | secret |
  | `state_bucket`             | `TF_STATE_BUCKET`          | secret |
  | `state_kms_key_arn`        | `TF_STATE_KMS_KEY_ARN`     | secret |
  | (optional) in-VPC DB URL   | `MIGRATION_DATABASE_URL`   | secret |
  | (optional) region override | `AWS_REGION`               | var    |

  `deploy_role_arns` is a map keyed by environment — set each env's own value on its matching
  Environment.
- **Deploy locally** (optional): `export TF_STATE_BUCKET=… TF_STATE_KMS_KEY_ARN=…` then
  `task tf:plan ENV=dev`.

## Deploy

- **Deploy**: the Deploy workflow runs only after the CI workflow has passed on `main` (`dev`), or on
  manual dispatch for `staging`/`prod` behind GitHub Environment protection rules. It assumes the
  per-environment OIDC role created by `infra/terraform/bootstrap/` (trust is scoped to
  `repo:<owner>/<repo>:environment:<env>`), then runs `task tf:apply ENV=<env>` (plan to a file, apply
  that plan; the plan is kept as a workflow artifact) followed by `task db:migrate` and, for dev/staging, `task smoke` (health + API Gateway behaviour checks;
  see docs/testing). **Migrations run
  after the new code is live**, so every migration must be backward-compatible with the previous
  version (expand/contract: add columns/tables first, switch code, drop later). Migrations are skipped
  with a warning when `MIGRATION_DATABASE_URL` is not set — the DB is private, so supply it via an
  in-VPC path (bastion/tunnel/self-hosted runner).
- **Required secrets/vars** (per GitHub Environment): `AWS_DEPLOY_ROLE_ARN` (the env's entry in the
  `deploy_role_arns` output), `TF_STATE_BUCKET` and `TF_STATE_KMS_KEY_ARN` (the `state_bucket` /
  `state_kms_key_arn` outputs) — all from the bootstrap step above — optionally
  `MIGRATION_DATABASE_URL`. Locally: `export TF_STATE_BUCKET=… TF_STATE_KMS_KEY_ARN=…` before
  `task tf:plan ENV=dev`.
- **Prod guardrails**: the stack refuses to plan `prod` without `alarm_email`, an explicit
  `cors_origin`, https callback/logout URLs, `db_multi_az = true`, `deletion_protection = true` and no
  password-auth test client (`infra/terraform/stack/variables.tf`).
- **Rollback**: migrations are forward-only — recover by **rolling forward**. Application rollback uses
  Lambda alias weighted routing to shift traffic back to the previous version.
- **Secret rotation**: DB credentials live in Secrets Manager (rotation is opt-in via
  `rotation_lambda_arn`); the Lambda re-reads the secret per new connection (cached 5 min), so a
  rotation needs no restart. Prefer RDS Proxy IAM auth (the default) to minimise standing secrets.
- **Observability**: CloudWatch dashboard, X-Ray traces, and structured JSON logs correlated by
  request id.

## Alerting

The `observability` module ships an SNS topic (`<service>-<env>-alarms`) and these CloudWatch alarms,
all wired to that topic:

| Alarm                   | Source metric                                       | Default trigger  | Why                                          |
| ----------------------- | --------------------------------------------------- | ---------------- | -------------------------------------------- |
| `lambda-errors`         | `AWS/Lambda Errors`                                 | > 5 in 5 min     | Handler failures                             |
| `lambda-throttles`      | `AWS/Lambda Throttles`                              | ≥ 1 in 5 min     | Concurrency exhaustion                       |
| `api-5xx`               | `AWS/ApiGateway 5XXError`                           | > 5 in 5 min     | Server-side failures                         |
| `api-latency-p99`       | `AWS/ApiGateway Latency` p99                        | > 2000 ms        | Latency regressions                          |
| `db-connection-pinning` | `AWS/RDS DatabaseConnectionsCurrentlySessionPinned` | > 5 (proxy only) | RDS Proxy pinning silently disabling pooling |

**Get notified:** set `alarm_email` (per env in `terraform.tfvars`; **required in prod**) to subscribe
an address to the topic — confirm the subscription email once. For Slack/PagerDuty, subscribe their
endpoint to the same topic instead. Thresholds are tunable via the module variables
(`error_threshold`, `latency_p99_ms`, `pinning_threshold`).

Alarm actions and the dashboard are visible in the CloudWatch console under the `<service>-<env>` name.
