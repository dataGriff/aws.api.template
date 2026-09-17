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
variable "log_retention_days" {
  type    = number
  default = 30
}
variable "tags" {
  type    = map(string)
  default = {}
}
