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

variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
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
variable "tags" {
  type    = map(string)
  default = {}
}
