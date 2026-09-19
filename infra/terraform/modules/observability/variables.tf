variable "name" { type = string }
variable "region" { type = string }
variable "lambda_function_name" { type = string }
variable "stage_name" { type = string }
variable "error_threshold" {
  type    = number
  default = 5
}
variable "latency_p99_ms" {
  type    = number
  default = 2000
}
variable "rds_proxy_name" {
  type    = string
  default = null
}
variable "pinning_threshold" {
  type    = number
  default = 5
}
variable "alarm_email" {
  type        = string
  default     = null
  description = "Email to subscribe to the alarm SNS topic (must confirm once)"
}
variable "tags" {
  type    = map(string)
  default = {}
}
variable "kms_key_arn" {
  type        = string
  default     = null
  description = "CMK for the alarm topic (policy must allow cloudwatch.amazonaws.com)"
}
