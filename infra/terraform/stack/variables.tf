variable "service_name" {
  type        = string
  description = "Base name threaded through every resource; change once to re-skin. Must match the name registered in the platform bootstrap (state backend + deploy role)."
  default     = "todo-api"
}
variable "env" { type = string }
variable "region" { type = string }

# --- Platform (aws.infra.template) --------------------------------------------
variable "platform_name" {
  type        = string
  default     = "platform"
  description = "The platform's name; its interface is read from /<platform_name>/<env>/ in SSM"
}
variable "platform_interface_version" {
  type        = string
  default     = "1"
  description = "The platform interface version this stack was written against (plan fails on a mismatch)"
}

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
  type        = bool
  default     = false
  description = "Attach this API's stage to the platform's web ACL (the platform env must have enable_waf on)"
}
variable "custom_domain_enabled" {
  type        = bool
  default     = false
  description = "Create <service_name>.<platform base_domain> with the platform's wildcard certificate (the platform env must have dns_enabled on)"
}
variable "custom_hostname" {
  type        = string
  default     = null
  description = "Override the default <service_name>.<base_domain> hostname (must still be under the platform's base_domain)"
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
variable "deletion_protection" {
  type    = bool
  default = false
  validation {
    condition     = var.env != "prod" || var.deletion_protection
    error_message = "deletion_protection must be true in prod."
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
variable "log_retention_days" {
  type        = number
  default     = 365
  description = "CloudWatch retention for this API's log groups (API access, Lambda). Prod-grade default; dev tfvars shorten it."
}
variable "disable_execute_api_endpoint" {
  type        = bool
  default     = true
  description = "When a custom domain is enabled, also switch off the default execute-api hostname."
}

# --- Build artifacts ---------------------------------------------------------
variable "api_dist_dir" {
  type    = string
  default = "../../../../packages/api/dist"
}

variable "tags" {
  type    = map(string)
  default = {}
}
