variable "region" {
  type    = string
  default = "eu-west-2"
}
variable "service_name" {
  type    = string
  default = "todo-api"
}
variable "db_engine" {
  type    = string
  default = "rds"
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
variable "alarm_email" {
  type    = string
  default = null
}

# --- Capacity / hardening (stack defaults are dev-sized; see terraform.tfvars) --
variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}
variable "db_multi_az" {
  type    = bool
  default = false
}
variable "db_backup_retention_days" {
  type    = number
  default = 7
}
variable "lambda_reserved_concurrency" {
  type    = number
  default = -1
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
variable "manage_apigw_account_settings" {
  type        = bool
  default     = true
  description = "Exactly ONE env per AWS account+region may manage the API Gateway account role; set false in the others."
}
variable "log_retention_days" {
  type    = number
  default = 365
}
