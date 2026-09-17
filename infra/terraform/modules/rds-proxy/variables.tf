variable "name" { type = string }
variable "region" { type = string }
variable "subnet_ids" { type = list(string) }
variable "security_group_ids" { type = list(string) }
variable "secret_arn" { type = string }
variable "db_instance_identifier" {
  type    = string
  default = null
}
variable "db_cluster_identifier" {
  type    = string
  default = null
}
variable "tags" {
  type    = map(string)
  default = {}
}
