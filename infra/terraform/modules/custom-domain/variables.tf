variable "hostname" {
  type        = string
  description = "Fully-qualified hostname, e.g. todo-api.dev.example.com (must be under the platform's base_domain)"
}
variable "certificate_arn" { type = string }
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
