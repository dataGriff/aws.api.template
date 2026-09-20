region        = "eu-west-2"
service_name  = "todo-api"
platform_name = "platform"

# Safety guard: a wrong active AWS profile can never apply prod into the wrong
# account. Update when prod moves to its own account.
allowed_account_ids = ["018648229057"]

# Production sizing. The stack REFUSES to plan prod without an explicit
# cors_origin, db_multi_az = true and deletion_protection (see
# infra/terraform/stack/variables.tf validations). Identity, WAF and alerting
# guardrails are the platform's.
db_engine                = "rds"
enable_rds_proxy         = true
db_instance_class        = "db.t4g.medium" # Performance Insights needs >= medium
db_multi_az              = true
db_backup_retention_days = 30

# Bound the Lambda to the connection budget of the proxy/DB (raise with the
# instance class). -1 = unreserved.
lambda_reserved_concurrency = 50

enable_waf            = true
custom_domain_enabled = false

cors_origin = "https://app.example.com"
