variable "state_bucket" { type = string }
variable "lock_table" {
  type    = string
  default = "terraform-locks"
}
variable "tags" {
  type    = map(string)
  default = {}
}
variable "noncurrent_version_retention_days" {
  type    = number
  default = 90
}
