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
variable "alarm_topic_arn" {
  type        = string
  description = "The platform's alarm SNS topic every alarm here publishes to"
}
variable "tags" {
  type    = map(string)
  default = {}
}
