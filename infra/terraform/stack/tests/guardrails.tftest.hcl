# Plan-time tests of the stack's guardrails. Providers are mocked, so this runs
# without credentials or network (terraform test, in `task tf:test`).

mock_provider "aws" {
  override_data {
    target = data.aws_availability_zones.available
    values = { names = ["eu-west-2a", "eu-west-2b", "eu-west-2c"] }
  }
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
}
mock_provider "random" {}
mock_provider "archive" {}

variables {
  service_name      = "todo-api"
  region            = "eu-west-2"
  api_dist_dir      = "../../../packages/api/dist"
  pretoken_dist_dir = "../../../packages/cognito-pretoken/dist"
}

# --- prod refuses unsafe inputs ----------------------------------------------
run "prod_refuses_missing_alarm_email" {
  command = plan
  variables {
    env                 = "prod"
    deletion_protection = true
    db_multi_az         = true
    cors_origin         = "https://app.example.com"
    callback_urls       = ["https://app.example.com/callback"]
    logout_urls         = ["https://app.example.com/"]
  }
  expect_failures = [var.alarm_email]
}

run "prod_refuses_wildcard_cors" {
  command = plan
  variables {
    env                 = "prod"
    deletion_protection = true
    db_multi_az         = true
    alarm_email         = "ops@example.com"
    cors_origin         = "*"
    callback_urls       = ["https://app.example.com/callback"]
    logout_urls         = ["https://app.example.com/"]
  }
  expect_failures = [var.cors_origin]
}

run "prod_refuses_localhost_callbacks" {
  command = plan
  variables {
    env                 = "prod"
    deletion_protection = true
    db_multi_az         = true
    alarm_email         = "ops@example.com"
    cors_origin         = "https://app.example.com"
    callback_urls       = ["http://localhost:3000/callback"]
    logout_urls         = ["https://app.example.com/"]
  }
  expect_failures = [var.callback_urls]
}

run "prod_refuses_single_az_and_test_client" {
  command = plan
  variables {
    env                 = "prod"
    deletion_protection = true
    db_multi_az         = false
    enable_test_client  = true
    alarm_email         = "ops@example.com"
    cors_origin         = "https://app.example.com"
    callback_urls       = ["https://app.example.com/callback"]
    logout_urls         = ["https://app.example.com/"]
  }
  expect_failures = [var.db_multi_az, var.enable_test_client]
}

run "prod_refuses_without_deletion_protection" {
  command = plan
  variables {
    env                 = "prod"
    deletion_protection = false
    db_multi_az         = true
    alarm_email         = "ops@example.com"
    cors_origin         = "https://app.example.com"
    callback_urls       = ["https://app.example.com/callback"]
    logout_urls         = ["https://app.example.com/"]
  }
  expect_failures = [var.deletion_protection]
}

# --- a hardened prod plans, with the protections actually in the plan ---------
run "prod_hardened" {
  command = plan
  variables {
    env                 = "prod"
    deletion_protection = true
    db_multi_az         = true
    db_instance_class   = "db.t4g.medium"
    alarm_email         = "ops@example.com"
    cors_origin         = "https://app.example.com"
    callback_urls       = ["https://app.example.com/callback"]
    logout_urls         = ["https://app.example.com/"]
    enable_waf          = true
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
    condition     = module.cognito.deletion_protection == "ACTIVE"
    error_message = "prod user pool must carry deletion protection"
  }
  assert {
    condition     = module.cognito.prevent_user_existence_errors == "ENABLED"
    error_message = "app client must not leak user existence"
  }
  assert {
    condition     = module.cognito.test_client_enabled == false
    error_message = "no password-auth test client in prod"
  }
  assert {
    condition     = length(module.waf) == 1
    error_message = "WAF must be attached when enable_waf is true"
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
    error_message = "lambda egress must stay VPC-internal without the static-egress opt-in"
  }
  assert {
    condition     = length(module.waf) == 0
    error_message = "WAF is opt-in"
  }
}

run "static_egress_opens_nat_route" {
  command = plan
  variables {
    env                     = "dev"
    enable_egress_static_ip = true
  }
  assert {
    condition     = length([for r in aws_security_group.lambda.egress : r if contains(coalesce(r.cidr_blocks, []), "0.0.0.0/0")]) == 1
    error_message = "the NAT opt-in must add exactly one 0.0.0.0/0 egress rule"
  }
  assert {
    condition     = module.network.nat_enabled == true
    error_message = "the NAT gateway must exist when static egress is enabled"
  }
}
