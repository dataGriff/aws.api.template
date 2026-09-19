variable "name" { type = string }
variable "stage_arn" { type = string }
variable "rate_limit" {
  type    = number
  default = 2000
}
variable "tags" {
  type    = map(string)
  default = {}
}
variable "kms_key_arn" {
  type    = string
  default = null
}
variable "log_retention_days" {
  type    = number
  default = 365
}
