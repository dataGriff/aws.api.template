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
  type        = list(string)
  description = "Interface endpoints the private subnets need (no NAT by default): every AWS API the Lambda calls, including X-Ray for tracing."
  default     = ["secretsmanager", "logs", "sts", "kms", "xray"]
}
variable "tags" {
  type    = map(string)
  default = {}
}
variable "kms_key_arn" {
  type        = string
  default     = null
  description = "CMK for the flow-log log group"
}
variable "log_retention_days" {
  type    = number
  default = 365
}
