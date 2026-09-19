region       = "eu-west-2"
service_name = "todo-api"

# Mirrors prod topology (proxy, WAF, multi-AZ) on smaller capacity.
db_engine                = "rds"
enable_rds_proxy         = true
db_instance_class        = "db.t4g.small"
db_multi_az              = true
db_backup_retention_days = 7

enable_waf               = true
enable_egress_static_ip  = false
enable_ingress_static_ip = false
custom_domain_enabled    = false
# domain_name    = "api.staging.example.com"
# hosted_zone_id = "Z0123456789ABCDEFGHIJ"
# alarm_email    = "alerts@example.com"

# Browser clients: the hosted-UI redirect and the CORS origin of your front end.
cors_origin   = "https://staging.app.example.com"
callback_urls = ["https://staging.app.example.com/callback"]
logout_urls   = ["https://staging.app.example.com/"]

# See envs/dev/terraform.tfvars: only one env per account+region manages this.
manage_apigw_account_settings = false
