region        = "eu-west-2"
service_name  = "todo-api"
platform_name = "platform"

# Safety guard: Terraform refuses to run if your active AWS credentials point at a
# different account. Update when this env moves to its own account.
allowed_account_ids = ["018648229057"]

# Mirrors prod topology (proxy, WAF, multi-AZ) on smaller capacity.
db_engine                = "rds"
enable_rds_proxy         = true
db_instance_class        = "db.t4g.small"
db_multi_az              = true
db_backup_retention_days = 7

enable_waf            = true # the staging platform has enable_waf on
custom_domain_enabled = false

# Shorter log retention than the 365-day prod default.
log_retention_days = 30

cors_origin = "https://staging.app.example.com"
