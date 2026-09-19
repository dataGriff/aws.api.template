variable "service_name" {
  type        = string
  description = "Base name threaded through every resource; change once to re-skin"
  default     = "todo-api"
}
variable "env" { type = string }
variable "region" { type = string }

# --- Feature flags (opt-in; safe defaults) -----------------------------------
variable "db_engine" {
  type    = string
  default = "rds"
  validation {
    condition     = contains(["rds", "aurora"], var.db_engine)
    error_message = "db_engine must be 'rds' or 'aurora'."
  }
}
variable "enable_rds_proxy" {
  type    = bool
  default = true
}
variable "enable_waf" {
  type    = bool
  default = false
}
variable "enable_egress_static_ip" {
  type    = bool
  default = false
}
variable "enable_ingress_static_ip" {
  type    = bool
  default = false
}
variable "ingress_target_ips" {
  type        = list(string)
  default     = []
  description = "Private IPs of the execute-api VPC endpoint ENIs (required when enable_ingress_static_ip is true)"
}
variable "custom_domain_enabled" {
  type    = bool
  default = false
}
variable "domain_name" {
  type    = string
  default = null
}
variable "hosted_zone_id" {
  type    = string
  default = null
}

# --- App config --------------------------------------------------------------
variable "db_name" {
  type    = string
  default = "app"
}
variable "db_username" {
  type    = string
  default = "app"
}
variable "stage_name" {
  type    = string
  default = "v1"
}
variable "cors_origin" {
  type        = string
  default     = "*"
  description = "Origin allowed by CORS (preflight + gateway error responses). Must be a real origin in prod."
  validation {
    condition     = var.env != "prod" || var.cors_origin != "*"
    error_message = "cors_origin must be an explicit origin (not '*') in prod."
  }
}
variable "callback_urls" {
  type        = list(string)
  default     = ["http://localhost:3000/callback"]
  description = "Hosted-UI OAuth redirect URIs for the app client. Must be https, non-localhost in prod."
  validation {
    condition     = var.env != "prod" || !anytrue([for u in var.callback_urls : !startswith(u, "https://")])
    error_message = "callback_urls must all be https:// (no localhost) in prod."
  }
}
variable "logout_urls" {
  type    = list(string)
  default = ["http://localhost:3000/"]
  validation {
    condition     = var.env != "prod" || !anytrue([for u in var.logout_urls : !startswith(u, "https://")])
    error_message = "logout_urls must all be https:// (no localhost) in prod."
  }
}
variable "enable_test_client" {
  type    = bool
  default = false
  validation {
    condition     = var.env != "prod" || !var.enable_test_client
    error_message = "The USER_PASSWORD_AUTH test client must not be enabled in prod."
  }
}
variable "deletion_protection" {
  type    = bool
  default = false
  validation {
    condition     = var.env != "prod" || var.deletion_protection
    error_message = "deletion_protection must be true in prod."
  }
}
variable "alarm_email" {
  type    = string
  default = null
  validation {
    condition     = var.env != "prod" || var.alarm_email != null
    error_message = "alarm_email is required in prod, otherwise every alarm fires into an SNS topic with no subscriber."
  }
}

# --- Capacity (defaults are dev-sized; override per env) ---------------------
variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}
variable "db_multi_az" {
  type    = bool
  default = false
  validation {
    condition     = var.env != "prod" || var.db_multi_az
    error_message = "db_multi_az must be true in prod (single-AZ has no automatic failover)."
  }
}
variable "db_backup_retention_days" {
  type    = number
  default = 7
}
variable "lambda_memory_size" {
  type    = number
  default = 512
}
variable "lambda_reserved_concurrency" {
  type        = number
  default     = -1
  description = "Cap on concurrent executions (-1 = none). Bound it to the DB/proxy connection budget."
}
variable "api_throttle_rate" {
  type    = number
  default = 50
}
variable "api_throttle_burst" {
  type    = number
  default = 100
}
variable "api_quota_limit" {
  type    = number
  default = 100000
}
variable "import_quarantine_retention_days" {
  type        = number
  default     = 90
  description = "How long CSV files rejected by the data contract (and their reports) stay in the import bucket's quarantine/ prefix"
}
variable "log_retention_days" {
  type        = number
  default     = 365
  description = "CloudWatch retention for every log group (API access, Lambda, trigger, WAF, VPC flow). Prod-grade default; dev tfvars shorten it."
}
variable "disable_execute_api_endpoint" {
  type        = bool
  default     = true
  description = "When a custom domain is enabled, also switch off the default execute-api hostname."
}
variable "manage_apigw_account_settings" {
  type        = bool
  default     = true
  description = "Manage the account-wide API Gateway CloudWatch role from this stack (exactly one stack per account+region)."
}
variable "monthly_budget_usd" {
  type        = number
  default     = null
  description = "If set (with alarm_email), creates a monthly cost budget alarm"
}

# --- Build artifacts ---------------------------------------------------------
variable "api_dist_dir" {
  type    = string
  default = "../../../../packages/api/dist"
}
variable "pretoken_dist_dir" {
  type    = string
  default = "../../../../packages/cognito-pretoken/dist"
}

variable "tags" {
  type    = map(string)
  default = {}
}
