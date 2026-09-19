# Security

The template is secure-by-default.

- **AuthN**: Cognito user pool issues JWTs; API Gateway Cognito authorizer validates them. A
  pre-token-generation trigger adds `custom:tenant_id` and role claims.
- **AuthZ**: every data access is scoped by the caller's `sub` **and** tenant claim in the repository
  layer (tested on each axis independently). Client-supplied owner ids are never trusted. Group
  membership is exposed as a `roles` claim and `isAdmin()` helper for the admin operations you add;
  the example API has none. There is no Postgres row-level security by design: RDS Proxy pins any
  session that sets state, so the repository layer is the single enforcement point (see ADR-10).
- **Gateway errors**: API Gateway's own rejections (authorizer 401, API-key 403, validator 400,
  throttling 429, WAF 403, 413) are rendered as `application/problem+json` with CORS headers via
  `x-amazon-apigateway-gateway-responses`, so browsers see the real status instead of an opaque CORS
  failure.
- **Consumer gating**: API keys + usage plans (throttling, quotas); WAF (opt-in, on in staging/prod)
  with the Common, Known-Bad-Inputs (Log4j) and IP-reputation managed rule groups, a rate-based rule,
  and full request logging to CloudWatch with credentials redacted.
- **File uploads (CSV import)**: the file never passes through the API or the Lambda's memory over
  HTTP. `POST /imports` records the import for the token's identity and mints a **pre-signed S3
  POST** whose policy pins the object key (`uploads/<tenant>/<import_id>.csv`), the content type,
  a `content-length-range` up to the contract's `maxBytes` and SSE-KMS with the stack's data key —
  S3 refuses anything else before it is stored. The bucket blocks public access, is versioned,
  TLS-only and denies unencrypted or differently keyed writes by policy; access logs go to a
  separate bucket. The ingest Lambda trusts only the `todo_imports` row the key maps to (never the
  file or the key) for tenant/user, validates the **whole file** against the ODCS data contract and
  then the same `todo_create` schema and NUL check as the API, and either creates every row in one
  transaction or **quarantines** the object with a full report (`quarantine/`, retained 90 days),
  records `rejected` with the first errors and raises the `import_rejected` alarm. Objects that did
  not come through the API are quarantined too. The ingest role can read/delete `uploads/*` and
  write `quarantine/*`, nothing else; the API role can only create under `uploads/*`. Delivery is
  at-least-once, so the final status transition is guarded in SQL inside the insert transaction.
- **Secrets**: Secrets Manager (+ rotation); prefer RDS Proxy IAM auth. Nothing sensitive in the repo.
- **Network**: VPC flow logs on; the VPC default security group is stripped of all rules; workload
  security groups only allow the egress they need (443 to the interface endpoints and the DynamoDB
  prefix list, 5432 to the proxy/database) — `0.0.0.0/0` exists only with the opt-in static-egress NAT.
- **Data**: two customer-managed KMS keys per stack — `data` (database storage, Performance Insights,
  credential secret, idempotency table, import bucket objects) and `ops` (every CloudWatch log
  group, the alarm SNS topic, the import queues, Lambda environment variables), each with an
  explicit key policy; TLS
  enforced by the server (`rds.force_ssl = 1`) as well as by RDS Proxy; multi-AZ, backups and deletion
  protection are mandatory in prod (stack validations). The Cognito user pool carries deletion
  protection wherever `deletion_protection` is set.
- **Cognito**: TOTP MFA available (`mfa_configuration`, default OPTIONAL), user-existence errors
  suppressed on every client, 7-day refresh tokens, no password-auth client in prod.
- **Supply chain / CI**: gitleaks, Trivy (vuln + IaC config), Checkov, Semgrep, and a CycloneDX SBOM — all via
  `task` targets so they run identically in hooks and CI. **Every scanner fails the build on findings.**
  Accepted findings are suppressed individually with a written reason (`.checkov.yaml`, `.trivyignore`,
  `.semgrepignore` / inline `nosemgrep`, `#checkov:skip`) — never with a blanket soft-fail. GitHub Actions are pinned to commit SHAs;
  Renovate only auto-merges dev tooling (with a 7-day release age). IAM is least-privilege; deploy
  uses OIDC (no long-lived keys) with the provider and per-environment roles defined in
  `infra/terraform/bootstrap/`, trust scoped to `repo:<owner>/<repo>:environment:<env>`.
