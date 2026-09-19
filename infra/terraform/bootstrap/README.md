# bootstrap

One-time-per-account Terraform that creates **one isolated state backend per environment** (a separate
S3 bucket + KMS key + DynamoDB lock table each) plus the GitHub OIDC provider and per-environment deploy
roles that every other env depends on. Backend names are derived from `service_name` + env (+ account),
and each deploy role is scoped to only its own env's state. Uses a local backend (it _creates_ the
remote ones).

Run it with `task tf:bootstrap SERVICE_NAME=<name> GITHUB_REPOSITORY=<owner/repo>` — see the
**First-time setup (bootstrap)** runbook in [`docs/operations`](../../../docs/operations/README.md).
