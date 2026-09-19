terraform {
  # 1.9+: variable validation rules may reference other variables (used for the
  # prod guardrails in variables.tf).
  required_version = ">= 1.9"
  required_providers {
    aws     = { source = "hashicorp/aws", version = ">= 5.60" }
    archive = { source = "hashicorp/archive", version = ">= 2.4" }
  }
}

# ONE API service deployed onto the platform (aws.infra.template). Everything
# shared — network, KMS keys, Cognito, WAF ACL, certificate, alarm topic —
# arrives through module.platform (SSM parameters); this stack owns only what
# is this API's: its Lambda, REST API, database + proxy + secret, idempotency
# table, alarms and hostname.

locals {
  name = "${var.service_name}-${var.env}"
  tags = merge(var.tags, {
    Service     = var.service_name
    Environment = var.env
    ManagedBy   = "terraform"
  })
}

module "platform" {
  source                = "../modules/platform"
  platform_name         = var.platform_name
  env                   = var.env
  enable_waf            = var.enable_waf
  custom_domain_enabled = var.custom_domain_enabled
}

# Fail fast when the platform speaks a different interface version than this
# stack was written against (names or semantics changed). Checked here in the
# root so `terraform test` can expect the failure.
resource "terraform_data" "platform_interface" {
  lifecycle {
    precondition {
      condition     = module.platform.interface_version == var.platform_interface_version
      error_message = "The platform at ${module.platform.prefix} publishes interface version '${module.platform.interface_version}'; this stack expects '${var.platform_interface_version}'. See aws.infra.template docs/interface."
    }
  }
}

# App security groups owned here to avoid a database<->lambda dependency cycle.
# Egress is scoped to what the workload actually talks to: AWS APIs through the
# platform's interface endpoints (443, inside the VPC), DynamoDB through its
# gateway endpoint (443, managed prefix list) and Postgres through the
# proxy/instance (5432, inside the VPC). Only when the platform has NAT
# (static egress IP) is 0.0.0.0/0 opened for third-party calls.
resource "aws_security_group" "lambda" {
  #checkov:skip=CKV_AWS_382:The only 0.0.0.0/0 egress rule is the dynamic block gated by the platform's nat_enabled (opt-in NAT for third-party calls); default egress is VPC-internal + the DynamoDB prefix list
  name_prefix = "${local.name}-lambda-"
  vpc_id      = module.platform.vpc_id
  description = "API Lambda"
  egress {
    description = "HTTPS to AWS interface endpoints inside the VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [module.platform.vpc_cidr]
  }
  egress {
    description     = "HTTPS to DynamoDB via the gateway endpoint"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    prefix_list_ids = [module.platform.dynamodb_prefix_list_id]
  }
  egress {
    description = "Postgres to RDS Proxy / instance inside the VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [module.platform.vpc_cidr]
  }
  dynamic "egress" {
    for_each = module.platform.nat_enabled ? [1] : []
    content {
      description = "Internet egress via the platform NAT (static egress IP)"
      from_port   = 0
      to_port     = 0
      protocol    = "-1"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }
  tags = local.tags
}

resource "aws_security_group" "proxy" {
  name_prefix = "${local.name}-proxy-"
  vpc_id      = module.platform.vpc_id
  description = "RDS Proxy"
  ingress {
    description     = "Postgres from the API Lambda"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }
  egress {
    description = "Postgres to the database inside the VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [module.platform.vpc_cidr]
  }
  egress {
    description = "HTTPS to Secrets Manager via its interface endpoint"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [module.platform.vpc_cidr]
  }
  tags = local.tags
}

module "secrets" {
  source     = "../modules/secrets"
  name       = local.name
  username   = var.db_username
  kms_key_id = module.platform.data_kms_key_arn
  # Ephemeral envs can be torn down and rebuilt inside the recovery window.
  recovery_window_in_days = var.deletion_protection ? 7 : 0
  tags                    = local.tags
}

module "database" {
  source                     = "../modules/database"
  name                       = local.name
  vpc_id                     = module.platform.vpc_id
  subnet_ids                 = module.platform.private_subnet_ids
  ingress_security_group_ids = var.enable_rds_proxy ? [aws_security_group.proxy.id] : [aws_security_group.lambda.id]
  engine                     = var.db_engine
  database_name              = var.db_name
  username                   = var.db_username
  password                   = module.secrets.password
  create_kms_key             = false
  kms_key_arn                = module.platform.data_kms_key_arn
  instance_class             = var.db_instance_class
  multi_az                   = var.db_multi_az
  backup_retention_days      = var.db_backup_retention_days
  deletion_protection        = var.deletion_protection
  apply_immediately          = !var.deletion_protection
  tags                       = local.tags
}

module "rds_proxy" {
  count                  = var.enable_rds_proxy ? 1 : 0
  source                 = "../modules/rds-proxy"
  name                   = local.name
  region                 = var.region
  subnet_ids             = module.platform.private_subnet_ids
  security_group_ids     = [aws_security_group.proxy.id]
  secret_arn             = module.secrets.secret_arn
  db_instance_identifier = var.db_engine == "rds" ? module.database.db_identifier : null
  db_cluster_identifier  = var.db_engine == "aurora" ? module.database.db_identifier : null
  tags                   = local.tags
}

resource "aws_dynamodb_table" "idempotency" {
  name         = "${local.name}-idempotency"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  ttl {
    attribute_name = "expiration"
    enabled        = true
  }
  point_in_time_recovery {
    enabled = true
  }
  server_side_encryption {
    enabled     = true
    kms_key_arn = module.platform.data_kms_key_arn
  }
  tags = local.tags
}

locals {
  db_host = var.enable_rds_proxy ? module.rds_proxy[0].endpoint : module.database.endpoint
}

module "lambda_api" {
  source                 = "../modules/lambda-api"
  name                   = local.name
  env                    = var.env
  region                 = var.region
  subnet_ids             = module.platform.private_subnet_ids
  security_group_ids     = [aws_security_group.lambda.id]
  dist_dir               = var.api_dist_dir
  memory_size            = var.lambda_memory_size
  reserved_concurrency   = var.lambda_reserved_concurrency
  log_retention_days     = var.log_retention_days
  kms_key_arn            = module.platform.ops_kms_key_arn
  data_kms_key_arn       = module.platform.data_kms_key_arn
  db_host                = local.db_host
  db_name                = var.db_name
  db_user                = var.db_username
  secret_arn             = module.secrets.secret_arn
  rds_iam_auth           = var.enable_rds_proxy
  rds_proxy_resource_id  = var.enable_rds_proxy ? module.rds_proxy[0].proxy_resource_id : null
  idempotency_table_name = aws_dynamodb_table.idempotency.name
  idempotency_table_arn  = aws_dynamodb_table.idempotency.arn
  tags                   = local.tags
}

module "api_gateway" {
  source                       = "../modules/api-gateway"
  name                         = local.name
  stage_name                   = var.stage_name
  lambda_invoke_arn            = module.lambda_api.invoke_arn
  lambda_function_name         = module.lambda_api.function_name
  cognito_user_pool_arn        = module.platform.cognito_user_pool_arn
  cors_origin                  = var.cors_origin
  throttle_rate                = var.api_throttle_rate
  throttle_burst               = var.api_throttle_burst
  quota_limit                  = var.api_quota_limit
  log_retention_days           = var.log_retention_days
  disable_execute_api_endpoint = var.custom_domain_enabled && var.disable_execute_api_endpoint
  kms_key_arn                  = module.platform.ops_kms_key_arn
  tags                         = local.tags
}

module "waf_association" {
  count       = var.enable_waf ? 1 : 0
  source      = "../modules/waf-association"
  stage_arn   = module.api_gateway.stage_arn
  web_acl_arn = module.platform.web_acl_arn
}

module "custom_domain" {
  count           = var.custom_domain_enabled ? 1 : 0
  source          = "../modules/custom-domain"
  hostname        = coalesce(var.custom_hostname, "${var.service_name}.${module.platform.base_domain}")
  certificate_arn = module.platform.certificate_arn
  hosted_zone_id  = module.platform.hosted_zone_id
  rest_api_id     = module.api_gateway.rest_api_id
  stage_name      = module.api_gateway.stage_name
  tags            = local.tags
}

module "observability" {
  source               = "../modules/observability"
  name                 = local.name
  region               = var.region
  lambda_function_name = module.lambda_api.function_name
  stage_name           = module.api_gateway.stage_name
  rds_proxy_name       = var.enable_rds_proxy ? local.name : null
  alarm_topic_arn      = module.platform.alarm_topic_arn
  tags                 = local.tags
}
