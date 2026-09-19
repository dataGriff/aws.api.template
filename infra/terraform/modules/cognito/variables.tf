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
variable "deletion_protection" {
  type        = bool
  default     = false
  description = "Refuse destroy/replacement of the user pool (set true wherever real users exist)."
}
variable "mfa_configuration" {
  type    = string
  default = "OPTIONAL"
  validation {
    condition     = contains(["OFF", "OPTIONAL", "ON"], var.mfa_configuration)
    error_message = "mfa_configuration must be OFF, OPTIONAL or ON."
  }
}
variable "advanced_security_mode" {
  type        = string
  default     = "OFF"
  description = "OFF | AUDIT | ENFORCED (AUDIT/ENFORCED need the Cognito Plus feature plan)."
  validation {
    condition     = contains(["OFF", "AUDIT", "ENFORCED"], var.advanced_security_mode)
    error_message = "advanced_security_mode must be OFF, AUDIT or ENFORCED."
  }
}
variable "refresh_token_validity_days" {
  type    = number
  default = 7
}
variable "log_retention_days" {
  type    = number
  default = 365
}
variable "kms_key_arn" {
  type        = string
  default     = null
  description = "CMK for the trigger's log group and environment variables"
}
variable "tags" {
  type    = map(string)
  default = {}
}
