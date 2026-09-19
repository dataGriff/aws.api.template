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
- **Consumer gating**: API keys + usage plans (throttling, quotas); WAF (opt-in) with managed rule sets
  and a rate-based rule.
- **Secrets**: Secrets Manager (+ rotation); prefer RDS Proxy IAM auth. Nothing sensitive in the repo.
- **Data**: one customer-managed KMS key per stack for the database and its credential secret; TLS
  enforced by the server (`rds.force_ssl = 1`) as well as by RDS Proxy; multi-AZ, backups and deletion
  protection are mandatory in prod (stack validations). The Cognito user pool carries deletion
  protection wherever `deletion_protection` is set.
- **Cognito**: TOTP MFA available (`mfa_configuration`, default OPTIONAL), user-existence errors
  suppressed on every client, 7-day refresh tokens, no password-auth client in prod.
- **Supply chain / CI**: gitleaks, Trivy (vuln + IaC config), Checkov, semgrep, and a CycloneDX SBOM — all via
  `task` targets so they run identically in hooks and CI. GitHub Actions are pinned to commit SHAs;
  Renovate only auto-merges dev tooling (with a 7-day release age). IAM is least-privilege; deploy
  uses OIDC (no long-lived keys) with the provider and per-environment roles defined in
  `infra/terraform/bootstrap/`, trust scoped to `repo:<owner>/<repo>:environment:<env>`.
