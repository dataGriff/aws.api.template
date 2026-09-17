module "stack" {
  source = "../../stack"

  service_name = var.service_name
  env          = "staging"
  region       = var.region

  db_engine                = var.db_engine
  enable_rds_proxy         = var.enable_rds_proxy
  enable_waf               = var.enable_waf
  enable_egress_static_ip  = var.enable_egress_static_ip
  enable_ingress_static_ip = var.enable_ingress_static_ip
  custom_domain_enabled    = var.custom_domain_enabled
  domain_name              = var.domain_name
  hosted_zone_id           = var.hosted_zone_id
  alarm_email              = var.alarm_email

  # staging mirrors prod topology but keeps a test client for E2E/fuzz.
  enable_test_client  = true
  deletion_protection = true
}
