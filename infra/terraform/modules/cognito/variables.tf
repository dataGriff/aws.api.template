variable "name" { type = string }
variable "region" { type = string }
variable "domain_suffix" {
  type        = string
  description = "Suffix to make the hosted-UI domain globally unique"
}
variable "pretoken_dist_dir" {
  type        = string
  description = "Path to the built pre-token Lambda (packages/cognito-pretoken/dist)"
}
variable "callback_urls" {
  type    = list(string)
  default = ["http://localhost:3000/callback"]
}
variable "logout_urls" {
  type    = list(string)
  default = ["http://localhost:3000/"]
}
variable "enable_test_client" {
  type    = bool
  default = false
}
variable "tags" {
  type    = map(string)
  default = {}
}
