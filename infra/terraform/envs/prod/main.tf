module "stack" {
  source = "../../stack"

  service_name  = var.service_name
  platform_name = var.platform_name
  env           = "prod"
  region        = var.region

  db_engine             = var.db_engine
  enable_rds_proxy      = var.enable_rds_proxy
  enable_waf            = var.enable_waf
  custom_domain_enabled = var.custom_domain_enabled
  custom_hostname       = var.custom_hostname

  # Capacity / hardening
  db_instance_class           = var.db_instance_class
  db_multi_az                 = var.db_multi_az
  db_backup_retention_days    = var.db_backup_retention_days
  lambda_reserved_concurrency = var.lambda_reserved_concurrency
  cors_origin                 = var.cors_origin
  log_retention_days          = var.log_retention_days

  deletion_protection = true
}
