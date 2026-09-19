# Security

The template is secure-by-default.

- **AuthN**: the **platform's** Cognito user pool issues JWTs (its pre-token-generation trigger
  adds `custom:tenant_id` and role claims); the API Gateway Cognito authorizer validates them
  against the pool ARN read from the platform interface.
- **Required claims**: the contract's `access_token_claims` schema (validated in `auth/claims.ts`
  with the package's generated zod) makes `sub` and `custom:tenant_id` mandatory — a valid token
  without them is a 401 — and documents `roles` for consumers; the platform's interface doc
  defines the same claims from the issuing side.
- **AuthZ**: every data access is scoped by the caller's `sub` **and** tenant claim in the repository
  layer (tested on each axis independently). Client-supplied owner ids are never trusted. Group
  membership is exposed as a `roles` claim and `isAdmin()` helper for the admin operations you add;
  the example API has none. There is no Postgres row-level security by design: RDS Proxy pins any
  session that sets state, so the repository layer is the single enforcement point (see ADR-10).
- **Gateway errors**: API Gateway's own rejections (authorizer 401, API-key 403, validator 400,
  throttling 429, WAF 403, 413) are rendered as `application/problem+json` with CORS headers via
  `x-amazon-apigateway-gateway-responses`, so browsers see the real status instead of an opaque CORS
  failure.
- **Consumer gating**: API keys + usage plans (throttling, quotas); the platform's WAF (managed
  rule groups + rate limit, redacted logging) attached to the stage with `enable_waf` (on in
  staging/prod).
- **Secrets**: Secrets Manager (+ rotation); prefer RDS Proxy IAM auth. Nothing sensitive in the repo.
- **Network**: the platform's VPC (flow logs on, default SG stripped, endpoints instead of NAT);
  this API's security groups only allow the egress they need (443 to the interface endpoints and
  the DynamoDB prefix list, 5432 to the proxy/database) — `0.0.0.0/0` exists only when the platform
  reports NAT (`network/nat_enabled`).
- **Data**: the platform's two CMKs — `data` (this API's database storage, Performance Insights,
  credential secret, idempotency table) and `ops` (its log groups, Lambda environment variables);
  TLS enforced by the server (`rds.force_ssl = 1`) as well as by RDS Proxy; multi-AZ, backups and
  deletion protection are mandatory in prod (stack validations).
- **Platform inputs**: read only from `/platform/<env>/…` (String/StringList identifiers, never
  secrets) by a deploy role that the platform scoped to this service's names, its own state and
  that prefix. No platform state is ever read.
- **Supply chain / CI**: gitleaks, Trivy (vuln + IaC config), Checkov, Semgrep, and a CycloneDX SBOM — all via
  `task` targets so they run identically in hooks and CI. **Every scanner fails the build on findings.**
  Accepted findings are suppressed individually with a written reason (`.checkov.yaml`, `.trivyignore`,
  `.semgrepignore` / inline `nosemgrep`, `#checkov:skip`) — never with a blanket soft-fail. GitHub Actions are pinned to commit SHAs;
  Renovate only auto-merges dev tooling (with a 7-day release age). IAM is least-privilege; deploy
  uses OIDC (no long-lived keys) with per-environment roles the **platform bootstrap** creates for
  this service, trust scoped to `repo:<owner>/<repo>:environment:<env>`. The contract package is
  installed from GitHub Packages with a read-only token; Renovate never auto-merges it.
