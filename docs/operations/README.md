# Operations

Runbooks for deploying and operating the API.

- **Deploy**: GitHub Actions assumes an OIDC role per environment, runs `task deploy ENV=<env>` which
  applies Terraform and runs migrations before shifting traffic. `dev` auto-deploys; `staging`/`prod`
  are gated.
- **Rollback**: migrations are forward-only — recover by **rolling forward**. Application rollback uses
  Lambda alias weighted routing to shift traffic back to the previous version.
- **Secret rotation**: DB credentials live in Secrets Manager with rotation enabled; prefer RDS Proxy
  IAM auth to minimise standing secrets.
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

**Get notified:** set `alarm_email` (per env, e.g. in `terraform.tfvars` or via CI) to subscribe an
address to the topic — confirm the subscription email once. For Slack/PagerDuty, subscribe their
endpoint to the same topic instead. Thresholds are tunable via the module variables
(`error_threshold`, `latency_p99_ms`, `pinning_threshold`).

Alarm actions and the dashboard are visible in the CloudWatch console under the `<service>-<env>` name.

_Runbook detail (paging, escalation) expanded in Phase 8._
