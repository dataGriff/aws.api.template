# Plan-time tests of the stack's guardrails and sizing rules, and of how it
# consumes the platform interface. Providers are mocked, so this runs without
# credentials or network (terraform test, in `task tf:test`).

mock_provider "aws" {
  # The provider validates policy JSON at plan time; a mocked random string fails.
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws", dns_suffix = "amazonaws.com" }
  }
  # The platform interface: every parameter reads as a syntactically valid ARN
  # unless a run overrides it (the ones with structure are overridden below).
  mock_data "aws_ssm_parameter" {
    defaults = { value = "arn:aws:mock:eu-west-2:123456789012:mock" }
  }
  override_data {
    target = module.platform.data.aws_ssm_parameter.required["interface/version"]
    values = { value = "1" }
  }
  override_data {
    target = module.platform.data.aws_ssm_parameter.required["alarms/topic_arn"]
    values = { value = "arn:aws:sns:eu-west-2:123456789012:platform-dev-alarms" }
  }
  override_data {
    target = module.platform.data.aws_ssm_parameter.required["network/vpc_id"]
    values = { value = "vpc-0123456789abcdef0" }
  }
  override_data {
    target = module.platform.data.aws_ssm_parameter.required["network/private_subnet_ids"]
    values = { value = "subnet-aaa,subnet-bbb" }
  }
  override_data {
    target = module.platform.data.aws_ssm_parameter.required["network/vpc_cidr"]
    values = { value = "10.0.0.0/16" }
  }
  override_data {
    target = module.platform.data.aws_ssm_parameter.required["network/nat_enabled"]
    values = { value = "false" }
  }
}
mock_provider "archive" {}

variables {
  service_name = "todo-api"
  region       = "eu-west-2"
  api_dist_dir = "../../../packages/api/dist"
}

# --- prod refuses unsafe inputs ----------------------------------------------
run "prod_refuses_wildcard_cors" {
  command = plan
  variables {
    env                 = "prod"
    deletion_protection = true
    db_multi_az         = true
    cors_origin         = "*"
  }
  expect_failures = [var.cors_origin]
}

run "prod_refuses_single_az" {
  command = plan
  variables {
    env                 = "prod"
    deletion_protection = true
    db_multi_az         = false
    cors_origin         = "https://app.example.com"
  }
  expect_failures = [var.db_multi_az]
}

run "prod_refuses_without_deletion_protection" {
  command = plan
  variables {
    env                 = "prod"
    deletion_protection = false
    db_multi_az         = true
    cors_origin         = "https://app.example.com"
  }
  expect_failures = [var.deletion_protection]
}

# --- the platform interface version is enforced ----------------------------------
run "refuses_other_interface_version" {
  command = plan
  variables {
    env                        = "dev"
    platform_interface_version = "2"
  }
  expect_failures = [terraform_data.platform_interface]
}

# --- a hardened prod plans, with the protections actually in the plan ---------
run "prod_hardened" {
  command = plan
  variables {
    env                   = "prod"
    deletion_protection   = true
    db_multi_az           = true
    db_instance_class     = "db.t4g.medium"
    cors_origin           = "https://app.example.com"
    enable_waf            = true
    custom_domain_enabled = true
  }
  override_data {
    target = module.platform.data.aws_ssm_parameter.optional["dns/base_domain"]
    values = { value = "example.com" }
  }
  assert {
    condition     = module.database.multi_az == true
    error_message = "prod database must be Multi-AZ"
  }
  assert {
    condition     = module.database.deletion_protection == true
    error_message = "prod database must have deletion protection"
  }
  assert {
    condition     = module.database.performance_insights_enabled == true
    error_message = "Performance Insights should be on for db.t4g.medium"
  }
  assert {
    condition     = module.database.force_ssl_parameters == ["rds.force_ssl"]
    error_message = "server-side TLS enforcement parameter group missing"
  }
  assert {
    condition     = length(module.waf_association) == 1
    error_message = "the stage must attach to the platform WAF when enable_waf is true"
  }
  assert {
    condition     = module.custom_domain[0].domain_name == "todo-api.example.com"
    error_message = "the hostname must be <service_name>.<platform base_domain>"
  }
}

# --- dev defaults ---------------------------------------------------------------
run "dev_defaults" {
  command = plan
  variables {
    env = "dev"
  }
  assert {
    condition     = module.database.performance_insights_enabled == false
    error_message = "Performance Insights is unsupported on db.t4g.micro and must be off"
  }
  assert {
    condition     = module.database.multi_az == false
    error_message = "dev is single-AZ by default"
  }
  assert {
    condition     = length([for r in aws_security_group.lambda.egress : r if contains(coalesce(r.cidr_blocks, []), "0.0.0.0/0")]) == 0
    error_message = "lambda egress must stay VPC-internal while the platform has no NAT"
  }
  assert {
    condition     = length(module.waf_association) == 0 && length(module.custom_domain) == 0
    error_message = "WAF association and custom domain are opt-in"
  }
  assert {
    condition     = module.platform.private_subnet_ids == tolist(["subnet-aaa", "subnet-bbb"])
    error_message = "the StringList parameter must be split into subnet ids"
  }
}

run "platform_nat_opens_egress" {
  command = plan
  variables {
    env = "dev"
  }
  override_data {
    target = module.platform.data.aws_ssm_parameter.required["network/nat_enabled"]
    values = { value = "true" }
  }
  assert {
    condition     = length([for r in aws_security_group.lambda.egress : r if contains(coalesce(r.cidr_blocks, []), "0.0.0.0/0")]) == 1
    error_message = "the platform's NAT must add exactly one 0.0.0.0/0 egress rule"
  }
}
