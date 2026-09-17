variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "target_ips" {
  type        = list(string)
  default     = []
  description = "Private IPs of the execute-api VPC endpoint ENIs"
}
variable "tags" {
  type    = map(string)
  default = {}
}
