variable "name" { type = string }
variable "region" { type = string }
variable "cidr" {
  type    = string
  default = "10.0.0.0/16"
}
variable "azs" { type = list(string) }
variable "enable_egress_static_ip" {
  type    = bool
  default = false
}
variable "interface_endpoints" {
  type    = list(string)
  default = ["secretsmanager", "logs", "sts", "kms"]
}
variable "tags" {
  type    = map(string)
  default = {}
}
