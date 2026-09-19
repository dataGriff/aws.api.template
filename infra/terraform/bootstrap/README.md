# bootstrap

One-time-per-account Terraform that creates the remote state backend (S3 + DynamoDB + KMS) and the
GitHub OIDC provider + per-environment deploy roles that every other env depends on. Uses a local
backend (it *creates* the remote one).

Run it with `task tf:bootstrap` — see the **First-time setup (bootstrap)** runbook in
[`docs/operations`](../../../docs/operations/README.md).
