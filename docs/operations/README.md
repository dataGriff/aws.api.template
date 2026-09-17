# Operations

Runbooks for deploying and operating the API.

- **Deploy**: GitHub Actions assumes an OIDC role per environment, runs `task deploy ENV=<env>` which
  applies Terraform and runs migrations before shifting traffic. `dev` auto-deploys; `staging`/`prod`
  are gated.
- **Rollback**: migrations are forward-only — recover by **rolling forward**. Application rollback uses
  Lambda alias weighted routing to shift traffic back to the previous version.
- **Secret rotation**: DB credentials live in Secrets Manager with rotation enabled; prefer RDS Proxy
  IAM auth to minimise standing secrets.
- **Observability**: CloudWatch dashboard + alarms (errors, latency, 5xx, DB connections, throttles),
  X-Ray traces, structured JSON logs correlated by request id.

_Expanded in Phase 8._
