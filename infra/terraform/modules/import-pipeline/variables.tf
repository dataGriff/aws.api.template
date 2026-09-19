variable "name" { type = string }
variable "env" { type = string }
variable "region" { type = string }
variable "subnet_ids" { type = list(string) }
variable "security_group_ids" { type = list(string) }
variable "dist_dir" {
  type        = string
  description = "Path to the built Lambda bundles (packages/api/dist); import-handler.js is packaged"
}

variable "db_host" { type = string }
variable "db_port" {
  type    = number
  default = 5432
}
variable "db_name" { type = string }
variable "db_user" { type = string }
variable "secret_arn" {
  type        = string
  description = "Secrets Manager secret holding the DB credentials"
}
variable "rds_iam_auth" {
  type    = bool
  default = false
}
variable "rds_proxy_resource_id" {
  type    = string
  default = null
}

variable "data_kms_key_arn" {
  type        = string
  description = "CMK every object in the imports bucket must be encrypted with (also protects the DB secret)"
}
variable "ops_kms_key_arn" {
  type        = string
  description = "CMK for the queues, the log group and the function's environment variables"
}
variable "alarm_topic_arn" {
  type        = string
  description = "SNS topic the rejected-import and dead-letter alarms notify"
}

variable "upload_retention_days" {
  type        = number
  default     = 7
  description = "How long an upload that was never processed (or its old versions) is kept"
}
variable "quarantine_retention_days" {
  type        = number
  default     = 90
  description = "How long quarantined files and their reports are kept for review"
}
variable "max_receive_count" {
  type        = number
  default     = 3
  description = "Ingest attempts per notification before it is parked on the dead-letter queue"
}
variable "reserved_concurrency" {
  type        = number
  default     = 2
  description = "Concurrent ingests (each holds a DB connection and one file in memory)"
}
variable "memory_size" {
  type    = number
  default = 512
}
variable "log_retention_days" {
  type    = number
  default = 365
}
variable "tags" {
  type    = map(string)
  default = {}
}
