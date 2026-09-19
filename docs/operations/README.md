# Operations

Runbooks for deploying and operating the API.

- **Deploy**: the Deploy workflow runs only after the CI workflow has passed on `main` (`dev`), or on
  manual dispatch for `staging`/`prod` behind GitHub Environment protection rules. It assumes the
  per-environment OIDC role created by `infra/terraform/bootstrap/` (trust is scoped to
  `repo:<owner>/<repo>:environment:<env>`), then runs `task tf:apply ENV=<env>` (plan to a file, apply
  that plan; the plan is kept as a workflow artifact) followed by `task db:migrate`. **Migrations run
  after the new code is live**, so every migration must be backward-compatible with the previous
  version (expand/contract: add columns/tables first, switch code, drop later). Migrations are skipped
  with a warning when `MIGRATION_DATABASE_URL` is not set — the DB is private, so supply it via an
  in-VPC path (bastion/tunnel/self-hosted runner).
- **Required secrets/vars** (per GitHub Environment): `AWS_DEPLOY_ROLE_ARN`, `TF_STATE_BUCKET`,
  `TF_STATE_KMS_KEY_ARN` (all from `terraform output` in `bootstrap/`), optionally
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
