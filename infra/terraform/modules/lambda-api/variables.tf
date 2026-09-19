variable "name" { type = string }
variable "env" { type = string }
variable "region" { type = string }
variable "subnet_ids" { type = list(string) }
variable "security_group_ids" { type = list(string) }
variable "dist_dir" {
  type        = string
  description = "Path to the built API Lambda (packages/api/dist)"
}

variable "db_host" { type = string }
variable "db_port" {
  type    = number
  default = 5432
}
variable "db_name" {
  type    = string
  default = "app"
}
variable "db_user" {
  type    = string
  default = "app"
}
variable "secret_arn" {
  type    = string
  default = null
}

variable "rds_proxy_resource_id" {
  type    = string
  default = null
}
variable "idempotency_table_name" {
  type    = string
  default = null
}
variable "idempotency_table_arn" {
  type    = string
  default = null
}

variable "memory_size" {
  type    = number
  default = 512
}
variable "reserved_concurrency" {
  type        = number
  default     = -1
  description = "Reserved concurrent executions (-1 = none). Size to the DB/proxy connection budget."
}
variable "log_retention_days" {
  type    = number
  default = 365
}
variable "extra_environment" {
  type    = map(string)
  default = {}
}
variable "tags" {
  type    = map(string)
  default = {}
}
variable "kms_key_arn" {
  type        = string
  default     = null
  description = "CMK for the log group and the function's environment variables"
}
variable "data_kms_key_arn" {
  type        = string
  default     = null
  description = "CMK protecting the DB secret and idempotency table (grants kms:Decrypt to the role)"
}
