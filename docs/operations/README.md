# Operations

Runbooks for deploying and operating the API.

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
| `import-rejected`       | `<service>-<env> import_rejected` (ingest metric)   | ≥ 1 in 1 min     | A CSV import violated the data contract      |
| `import-dead-letter`    | `AWS/SQS ApproximateNumberOfMessagesVisible` (DLQ)  | ≥ 1              | The ingest itself failed after 3 attempts    |

**Get notified:** set `alarm_email` (per env in `terraform.tfvars`; **required in prod**) to subscribe
an address to the topic — confirm the subscription email once. For Slack/PagerDuty, subscribe their
endpoint to the same topic instead. Thresholds are tunable via the module variables
(`error_threshold`, `latency_p99_ms`, `pinning_threshold`).

Alarm actions and the dashboard are visible in the CloudWatch console under the `<service>-<env>` name.

## CSV imports: quarantine and dead letters

- **`import-rejected` fired.** A file did not meet `api/todo-import.odcs.yaml`. Nothing was created.
  The object was moved to `s3://<import_bucket>/quarantine/<tenant>/<import_id>.csv` with the full
  report next to it (`….csv.report.json`: every violation with row and field); the import's API
  status is `rejected` with the first 100 errors, so the uploader can fix and re-upload through a new
  `POST /imports`. Quarantine expires after `import_quarantine_retention_days` (90). If the report
  shows `import_id: null`, the object did **not** come through the API (a direct write to
  `uploads/`): treat as a security event and check who has `s3:PutObject` on the bucket.
- **`import-dead-letter` fired.** The ingest crashed repeatedly (database or S3 unreachable, a bug).
  The file is still under `uploads/` and the import shows `processing`. Fix the cause, then redrive
  the DLQ (`<service>-<env>-import-dlq`) to the source queue from the SQS console or
  `aws sqs start-message-move-task`; processing is idempotent, a duplicate delivery never
  double-creates. Unprocessed uploads expire after `upload_retention_days` (7).
- **Outputs**: `import_bucket`, `import_dead_letter_queue` (`terraform output`).
