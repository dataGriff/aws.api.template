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
  type    = string
  default = "*"
}
variable "callback_urls" {
  type    = list(string)
  default = ["http://localhost:3000/callback"]
}
variable "logout_urls" {
  type    = list(string)
  default = ["http://localhost:3000/"]
}
variable "enable_test_client" {
  type    = bool
  default = false
}
variable "deletion_protection" {
  type    = bool
  default = false
}
variable "alarm_email" {
  type    = string
  default = null
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
