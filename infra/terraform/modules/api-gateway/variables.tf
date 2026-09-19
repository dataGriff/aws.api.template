variable "name" { type = string }
variable "stage_name" {
  type    = string
  default = "v1"
}
variable "lambda_invoke_arn" { type = string }
variable "lambda_function_name" { type = string }
variable "cognito_user_pool_arn" { type = string }
variable "cors_origin" {
  type    = string
  default = "*"
}
variable "throttle_rate" {
  type    = number
  default = 50
}
variable "throttle_burst" {
  type    = number
  default = 100
}
variable "quota_limit" {
  type    = number
  default = 100000
}
variable "disable_execute_api_endpoint" {
  type    = bool
  default = false
}
variable "manage_account_settings" {
  type        = bool
  default     = true
  description = "Manage the account-level API Gateway CloudWatch role (one stack per account+region)."
}
variable "log_retention_days" {
  type    = number
  default = 365
}
variable "kms_key_arn" {
  type        = string
  default     = null
  description = "CMK for the access-log log group"
}
variable "tags" {
  type    = map(string)
  default = {}
}
