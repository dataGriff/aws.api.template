variable "state_bucket" { type = string }
variable "lock_table" {
  type    = string
  default = "terraform-locks"
}
variable "kms_alias" {
  type        = string
  description = "Short alias name (without the alias/ prefix) for the state KMS key, so backends can reference it without the account-specific key id"
}
variable "tags" {
  type    = map(string)
  default = {}
}
variable "noncurrent_version_retention_days" {
  type    = number
  default = 90
}
