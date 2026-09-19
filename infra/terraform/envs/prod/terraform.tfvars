region       = "eu-west-2"
service_name = "todo-api"

# Safety guard — strongly recommended in prod: set THIS env's account id so a wrong
# active AWS profile can never apply prod into the wrong account.
# allowed_account_ids = ["123456789012"]

# Production sizing. The stack REFUSES to plan prod without: alarm_email, an
# explicit cors_origin, https callback/logout URLs, db_multi_az = true and
# deletion_protection (see infra/terraform/stack/variables.tf validations).
db_engine                = "rds"
enable_rds_proxy         = true
db_instance_class        = "db.t4g.medium" # Performance Insights needs >= medium
db_multi_az              = true
db_backup_retention_days = 30

# Bound the Lambda to the connection budget of the proxy/DB (raise with the
# instance class). -1 = unreserved.
lambda_reserved_concurrency = 50

enable_waf               = true
enable_egress_static_ip  = false
enable_ingress_static_ip = false
custom_domain_enabled    = false
# domain_name    = "api.example.com"
# hosted_zone_id = "Z0123456789ABCDEFGHIJ"

# REQUIRED in prod — replace before the first plan:
# alarm_email = "alerts@example.com"
cors_origin   = "https://app.example.com"
callback_urls = ["https://app.example.com/callback"]
logout_urls   = ["https://app.example.com/"]

# See envs/dev/terraform.tfvars: only one env per account+region manages this.
manage_apigw_account_settings = false
