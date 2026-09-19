region       = "eu-west-2"
service_name = "todo-api"

# Safety guard: uncomment with THIS env's account id so Terraform refuses to run
# if your active AWS credentials point at a different account.
# allowed_account_ids = ["123456789012"]

# Cheapest representative setup for dev.
db_engine                = "rds"
enable_rds_proxy         = true
db_instance_class        = "db.t4g.micro"
db_multi_az              = false
db_backup_retention_days = 1

# Opt-ins (default off). Flip on and re-plan to add:
enable_waf               = false
enable_egress_static_ip  = false
enable_ingress_static_ip = false
custom_domain_enabled    = false
# domain_name    = "api.dev.example.com"
# hosted_zone_id = "Z0123456789ABCDEFGHIJ"
# alarm_email    = "alerts@example.com"

# Shorter log retention than the 365-day prod default.
log_retention_days = 14

# Browser clients: the hosted-UI redirect and the CORS origin of your front end.
cors_origin   = "*"
callback_urls = ["http://localhost:3000/callback"]
logout_urls   = ["http://localhost:3000/"]

# The account-wide API Gateway logging role is managed from ONE env per
# account+region. If dev/staging/prod share an account, keep true here and set
# false in the others.
manage_apigw_account_settings = true
