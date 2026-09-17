variable "domain_name" { type = string }
variable "hosted_zone_id" { type = string }
variable "rest_api_id" { type = string }
variable "stage_name" { type = string }
variable "base_path" {
  type    = string
  default = ""
}
variable "tags" {
  type    = map(string)
  default = {}
}
