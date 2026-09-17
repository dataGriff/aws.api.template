variable "name" { type = string }
variable "username" {
  type    = string
  default = "app"
}
variable "kms_key_id" {
  type    = string
  default = null
}
variable "recovery_window_in_days" {
  type    = number
  default = 7
}
variable "rotation_lambda_arn" {
  type    = string
  default = null
}
variable "rotation_days" {
  type    = number
  default = 30
}
variable "tags" {
  type    = map(string)
  default = {}
}
