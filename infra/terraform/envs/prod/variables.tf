variable "region" {
  type    = string
  default = "eu-west-2"
}
variable "service_name" {
  type    = string
  default = "todo-api"
}
variable "platform_name" {
  type    = string
  default = "platform"
}
variable "allowed_account_ids" {
  type        = list(string)
  default     = []
  description = "Safety guard: if non-empty, Terraform refuses to run against any AWS account not in this list, so a wrong active profile can't deploy to the wrong account. Set it to this env's account id in terraform.tfvars."
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
variable "custom_domain_enabled" {
  type    = bool
  default = false
}
variable "custom_hostname" {
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
variable "log_retention_days" {
  type    = number
  default = 365
}
