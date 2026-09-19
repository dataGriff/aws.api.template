variable "platform_name" {
  type        = string
  default     = "platform"
  description = "The platform's name (its SSM prefix is /<platform_name>/<env>/)"
}
variable "env" { type = string }
variable "enable_waf" {
  type        = bool
  default     = false
  description = "Read waf/web_acl_arn (the platform must have enable_waf on)"
}
variable "custom_domain_enabled" {
  type        = bool
  default     = false
  description = "Read dns/* (the platform must have dns_enabled on)"
}
