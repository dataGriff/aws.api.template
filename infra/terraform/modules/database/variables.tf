variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "ingress_security_group_ids" { type = list(string) }

variable "engine" {
  type        = string
  default     = "rds"
  description = "rds (single instance) or aurora (Serverless v2)"
  validation {
    condition     = contains(["rds", "aurora"], var.engine)
    error_message = "engine must be 'rds' or 'aurora'."
  }
}

variable "database_name" {
  type    = string
  default = "app"
}
variable "username" {
  type    = string
  default = "app"
}
variable "password" {
  type      = string
  sensitive = true
}

variable "create_kms_key" {
  type        = bool
  default     = true
  description = "Create a CMK for storage encryption. Set false and pass kms_key_arn to reuse one. (A boolean rather than `kms_key_arn == null` because the ARN is unknown until apply and count/for_each need a known value at plan time.)"
}
variable "kms_key_arn" {
  type        = string
  default     = null
  description = "Existing CMK ARN, used when create_kms_key = false."
}

variable "instance_class" {
  type        = string
  default     = "db.t4g.micro"
  description = "RDS instance class (rds engine only). Performance Insights is enabled automatically on classes that support it (not micro/small)."
}
variable "multi_az" {
  type        = bool
  default     = false
  description = "Standby in a second AZ (rds) / a second serverless instance (aurora) for automatic failover. Set true in prod."
}
variable "postgres_version" {
  type    = string
  default = "16.4"
}
variable "aurora_version" {
  type    = string
  default = "16.4"
}
variable "aurora_min_acu" {
  type    = number
  default = 0.5
}
variable "aurora_max_acu" {
  type    = number
  default = 4
}
variable "backup_retention_days" {
  type    = number
  default = 7
}
variable "deletion_protection" {
  type    = bool
  default = false
}
variable "apply_immediately" {
  type        = bool
  default     = false
  description = "Apply modifications immediately instead of in the next maintenance window (dev convenience)."
}
variable "tags" {
  type    = map(string)
  default = {}
}
