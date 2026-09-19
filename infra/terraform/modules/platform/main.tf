terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.60" }
  }
}

# The platform (aws.infra.template) publishes everything an API needs as SSM
# parameters under /<platform_name>/<env>/ — see that repo's docs/interface.
# This module is the ONLY place the API stack touches the platform: it reads
# the parameters and exposes them as typed outputs. It never reads platform
# state.
locals {
  prefix = "/${var.platform_name}/${var.env}"
  required = [
    "interface/version",
    "network/vpc_id",
    "network/vpc_cidr",
    "network/private_subnet_ids",
    "network/dynamodb_prefix_list_id",
    "network/nat_enabled",
    "kms/data_key_arn",
    "kms/ops_key_arn",
    "cognito/user_pool_arn",
    "alarms/topic_arn",
  ]
  # Optional parameters exist only when the platform feature is on; reading one
  # the platform does not publish fails the plan with a clear "not found".
  optional = concat(
    var.enable_waf ? ["waf/web_acl_arn"] : [],
    var.custom_domain_enabled ? ["dns/hosted_zone_id", "dns/base_domain", "dns/certificate_arn"] : [],
  )
}

data "aws_ssm_parameter" "required" {
  for_each = toset(local.required)
  name     = "${local.prefix}/${each.key}"
}

data "aws_ssm_parameter" "optional" {
  for_each = toset(local.optional)
  name     = "${local.prefix}/${each.key}"
}
