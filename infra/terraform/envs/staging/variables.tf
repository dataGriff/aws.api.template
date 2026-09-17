variable "region" {
  type    = string
  default = "eu-west-2"
}
variable "service_name" {
  type    = string
  default = "todo-api"
}
variable "db_engine" {
  type    = string
  default = "rds"
}
variable "enable_rds_proxy" {
  type    = bool
  default = true
}
variable "enable_waf" {
  type    = bool
  default = false
}
variable "enable_egress_static_ip" {
  type    = bool
  default = false
}
variable "enable_ingress_static_ip" {
  type    = bool
  default = false
}
variable "custom_domain_enabled" {
  type    = bool
  default = false
}
variable "domain_name" {
  type    = string
  default = null
}
variable "hosted_zone_id" {
  type    = string
  default = null
}
variable "alarm_email" {
  type    = string
  default = null
}
