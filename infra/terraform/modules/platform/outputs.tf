# SSM marks every parameter value sensitive; the interface publishes only
# non-secret identifiers (see aws.infra.template docs/interface), so they are
# unwrapped here — otherwise every subnet id and ARN would be hidden in plans.
locals {
  req = { for k, p in data.aws_ssm_parameter.required : k => nonsensitive(p.value) }
  opt = { for k, p in data.aws_ssm_parameter.optional : k => nonsensitive(p.value) }
}

output "prefix" { value = local.prefix }
output "interface_version" { value = local.req["interface/version"] }
output "vpc_id" { value = local.req["network/vpc_id"] }
output "vpc_cidr" { value = local.req["network/vpc_cidr"] }
output "private_subnet_ids" { value = split(",", local.req["network/private_subnet_ids"]) }
output "dynamodb_prefix_list_id" { value = local.req["network/dynamodb_prefix_list_id"] }
output "nat_enabled" {
  value       = local.req["network/nat_enabled"] == "true"
  description = "Whether the platform's private subnets have internet egress (NAT)"
}
output "data_kms_key_arn" { value = local.req["kms/data_key_arn"] }
output "ops_kms_key_arn" { value = local.req["kms/ops_key_arn"] }
output "cognito_user_pool_arn" { value = local.req["cognito/user_pool_arn"] }
output "alarm_topic_arn" { value = local.req["alarms/topic_arn"] }
output "web_acl_arn" { value = var.enable_waf ? local.opt["waf/web_acl_arn"] : null }
output "hosted_zone_id" { value = var.custom_domain_enabled ? local.opt["dns/hosted_zone_id"] : null }
output "base_domain" { value = var.custom_domain_enabled ? local.opt["dns/base_domain"] : null }
output "certificate_arn" { value = var.custom_domain_enabled ? local.opt["dns/certificate_arn"] : null }
