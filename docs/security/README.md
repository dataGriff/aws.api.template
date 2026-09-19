# Security

The template is secure-by-default.

- **AuthN**: Cognito user pool issues JWTs; API Gateway Cognito authorizer validates them. A
  pre-token-generation trigger adds `custom:tenant_id` and role claims.
- **AuthZ**: every data access is scoped by the caller's `sub`/tenant claim in the repository layer.
  Client-supplied owner ids are never trusted. Role/group claims gate admin operations.
- **Consumer gating**: API keys + usage plans (throttling, quotas); WAF (opt-in) with managed rule sets
  and a rate-based rule.
- **Secrets**: Secrets Manager (+ rotation); prefer RDS Proxy IAM auth. Nothing sensitive in the repo.
- **Data**: KMS encryption at rest, TLS in transit, PITR + deletion protection in prod.
- **Supply chain / CI**: gitleaks, Trivy (vuln + IaC config), Checkov, semgrep, and a CycloneDX SBOM — all via
  `task` targets so they run identically in hooks and CI. IAM is least-privilege; deploy uses OIDC
  (no long-lived keys), trust scoped per repo + branch/tag.
