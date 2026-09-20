region        = "eu-west-2"
service_name  = "todo-api"
platform_name = "platform" # the platform env this API deploys onto (/platform/dev/...)

# Safety guard: Terraform refuses to run if your active AWS credentials point at a
# different account. Update when this env moves to its own account.
allowed_account_ids = ["018648229057"]

# Cheapest representative setup for dev.
db_engine                = "rds"
enable_rds_proxy         = true
db_instance_class        = "db.t4g.micro"
db_multi_az              = false
db_backup_retention_days = 1

# Opt-ins (default off). Each needs the matching platform feature on:
enable_waf            = false # platform enable_waf
custom_domain_enabled = false # platform dns_enabled -> todo-api.<base_domain>

# Shorter log retention than the 365-day prod default.
log_retention_days = 14

# Browser clients: the CORS origin of your front end.
cors_origin = "*"
