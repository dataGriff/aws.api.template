region       = "eu-west-2"
service_name = "todo-api"

# Cheapest representative setup for dev.
db_engine        = "rds"
enable_rds_proxy = true

# Opt-ins (default off). Flip on and re-plan to add:
enable_waf               = false
enable_egress_static_ip  = false
enable_ingress_static_ip = false
custom_domain_enabled    = false
# domain_name    = "api.dev.example.com"
# hosted_zone_id = "Z0123456789ABCDEFGHIJ"
# alarm_email    = "alerts@example.com"
