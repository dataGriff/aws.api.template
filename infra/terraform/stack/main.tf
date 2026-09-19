terraform {
  # 1.9+: variable validation rules may reference other variables (used for the
  # prod guardrails in variables.tf).
  required_version = ">= 1.9"
  required_providers {
    aws     = { source = "hashicorp/aws", version = ">= 5.60" }
    random  = { source = "hashicorp/random", version = ">= 3.6" }
    archive = { source = "hashicorp/archive", version = ">= 2.4" }
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "random_string" "suffix" {
  length  = 6
  lower   = true
  upper   = false
  special = false
}

locals {
  name = "${var.service_name}-${var.env}"
  azs  = slice(data.aws_availability_zones.available.names, 0, 2)
  tags = merge(var.tags, {
    Service     = var.service_name
    Environment = var.env
    ManagedBy   = "terraform"
  })
}

# Guard interdependent flags. Uses a terraform_data precondition rather than a
# top-level `check` block so all IaC scanners (some lag on newer HCL) parse it.
resource "terraform_data" "guardrails" {
  lifecycle {
    precondition {
      condition     = !var.custom_domain_enabled || (var.domain_name != null && var.hosted_zone_id != null)
      error_message = "custom_domain_enabled requires domain_name and hosted_zone_id."
    }
  }
}

module "network" {
  source                  = "../modules/network"
  name                    = local.name
  region                  = var.region
  azs                     = local.azs
  enable_egress_static_ip = var.enable_egress_static_ip
  kms_key_arn             = aws_kms_key.ops.arn
  log_retention_days      = var.log_retention_days
  tags                    = local.tags
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

# --- Customer-managed keys with explicit policies -----------------------------
# data: database storage, Performance Insights, the credential secret and the
# idempotency table. Callers reach it through the services (grants), so the
# policy only needs the account root; IAM policies on the roles do the rest.
data "aws_iam_policy_document" "kms_data" {
  #checkov:skip=CKV_AWS_109:Standard AWS key policy — the account root principal must keep kms:* or the key becomes unmanageable; access is delegated through IAM
  #checkov:skip=CKV_AWS_111:Standard AWS key policy — the account root principal must keep kms:* or the key becomes unmanageable; access is delegated through IAM
  #checkov:skip=CKV_AWS_356:Standard AWS key policy — resources must be "*" inside a key policy (it applies to the key itself)
  statement {
    sid       = "AccountAdmin"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
}

resource "aws_kms_key" "data" {
  description             = "${local.name} data encryption (database + credentials + idempotency table)"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.kms_data.json
  tags                    = local.tags
}

# ops: CloudWatch log groups, the alarm SNS topic and Lambda environment
# variables. CloudWatch Logs and CloudWatch Alarms encrypt/decrypt with it as
# services, so they need explicit grants in the key policy.
data "aws_iam_policy_document" "kms_ops" {
  #checkov:skip=CKV_AWS_109:Standard AWS key policy — the account root principal must keep kms:* or the key becomes unmanageable; access is delegated through IAM
  #checkov:skip=CKV_AWS_111:Standard AWS key policy — the account root principal must keep kms:* or the key becomes unmanageable; access is delegated through IAM
  #checkov:skip=CKV_AWS_356:Standard AWS key policy — resources must be "*" inside a key policy (it applies to the key itself)
  statement {
    sid       = "AccountAdmin"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
  statement {
    sid = "CloudWatchLogs"
    actions = [
      "kms:Encrypt*",
      "kms:Decrypt*",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:Describe*",
    ]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["logs.${var.region}.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:${data.aws_partition.current.partition}:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:*"]
    }
  }
  statement {
    sid       = "CloudWatchAlarmsToSns"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey*"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }
  }
}

resource "aws_kms_key" "ops" {
  description             = "${local.name} operational encryption (logs, alarms topic, Lambda environment)"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.kms_ops.json
  tags                    = local.tags
}

# App security groups owned here to avoid a database<->lambda dependency cycle.
# Egress is scoped to what the workload actually talks to: AWS APIs through the
# interface endpoints (443, inside the VPC), DynamoDB through its gateway
# endpoint (443, managed prefix list) and Postgres through the proxy/instance
# (5432, inside the VPC). Only the opt-in static-egress NAT path opens 0.0.0.0/0.
resource "aws_security_group" "lambda" {
  #checkov:skip=CKV_AWS_382:The only 0.0.0.0/0 egress rule is the dynamic block gated by enable_egress_static_ip (opt-in NAT for third-party calls); default egress is VPC-internal + the DynamoDB prefix list
  name_prefix = "${local.name}-lambda-"
  vpc_id      = module.network.vpc_id
  description = "API Lambda"
  egress {
    description = "HTTPS to AWS interface endpoints inside the VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [module.network.vpc_cidr]
  }
  egress {
    description     = "HTTPS to DynamoDB via the gateway endpoint"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    prefix_list_ids = [module.network.dynamodb_prefix_list_id]
  }
  egress {
    description = "Postgres to RDS Proxy / instance inside the VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [module.network.vpc_cidr]
  }
  dynamic "egress" {
    for_each = var.enable_egress_static_ip ? [1] : []
    content {
      description = "Internet egress via NAT (opt-in static egress IP)"
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
  vpc_id      = module.network.vpc_id
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
    cidr_blocks = [module.network.vpc_cidr]
  }
  egress {
    description = "HTTPS to Secrets Manager via its interface endpoint"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [module.network.vpc_cidr]
  }
  tags = local.tags
}

module "secrets" {
  source     = "../modules/secrets"
  name       = local.name
  username   = var.db_username
  kms_key_id = aws_kms_key.data.arn
  # Ephemeral envs can be torn down and rebuilt inside the recovery window.
  recovery_window_in_days = var.deletion_protection ? 7 : 0
  tags                    = local.tags
}

module "database" {
  source                     = "../modules/database"
  name                       = local.name
  vpc_id                     = module.network.vpc_id
  subnet_ids                 = module.network.private_subnet_ids
  ingress_security_group_ids = var.enable_rds_proxy ? [aws_security_group.proxy.id] : [aws_security_group.lambda.id]
  engine                     = var.db_engine
  database_name              = var.db_name
  username                   = var.db_username
  password                   = module.secrets.password
  create_kms_key             = false
  kms_key_arn                = aws_kms_key.data.arn
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
  subnet_ids             = module.network.private_subnet_ids
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
    kms_key_arn = aws_kms_key.data.arn
  }
  tags = local.tags
}

module "cognito" {
  source              = "../modules/cognito"
  name                = local.name
  region              = var.region
  domain_suffix       = random_string.suffix.result
  pretoken_dist_dir   = var.pretoken_dist_dir
  enable_test_client  = var.enable_test_client
  callback_urls       = var.callback_urls
  logout_urls         = var.logout_urls
  deletion_protection = var.deletion_protection
  log_retention_days  = var.log_retention_days
  kms_key_arn         = aws_kms_key.ops.arn
  tags                = local.tags
}

locals {
  db_host = var.enable_rds_proxy ? module.rds_proxy[0].endpoint : module.database.endpoint
}

module "lambda_api" {
  source                 = "../modules/lambda-api"
  name                   = local.name
  env                    = var.env
  region                 = var.region
  subnet_ids             = module.network.private_subnet_ids
  security_group_ids     = [aws_security_group.lambda.id]
  dist_dir               = var.api_dist_dir
  memory_size            = var.lambda_memory_size
  reserved_concurrency   = var.lambda_reserved_concurrency
  log_retention_days     = var.log_retention_days
  kms_key_arn            = aws_kms_key.ops.arn
  data_kms_key_arn       = aws_kms_key.data.arn
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
  cognito_user_pool_arn        = module.cognito.user_pool_arn
  cors_origin                  = var.cors_origin
  throttle_rate                = var.api_throttle_rate
  throttle_burst               = var.api_throttle_burst
  quota_limit                  = var.api_quota_limit
  log_retention_days           = var.log_retention_days
  disable_execute_api_endpoint = var.custom_domain_enabled && var.disable_execute_api_endpoint
  manage_account_settings      = var.manage_apigw_account_settings
  kms_key_arn                  = aws_kms_key.ops.arn
  tags                         = local.tags
}

module "waf" {
  count              = var.enable_waf ? 1 : 0
  source             = "../modules/waf"
  name               = local.name
  stage_arn          = module.api_gateway.stage_arn
  kms_key_arn        = aws_kms_key.ops.arn
  log_retention_days = var.log_retention_days
  tags               = local.tags
}

module "custom_dns" {
  count          = var.custom_domain_enabled ? 1 : 0
  source         = "../modules/custom-dns"
  domain_name    = var.domain_name
  hosted_zone_id = var.hosted_zone_id
  rest_api_id    = module.api_gateway.rest_api_id
  stage_name     = module.api_gateway.stage_name
  tags           = local.tags
}

module "ingress_static_ip" {
  count               = var.enable_ingress_static_ip ? 1 : 0
  source              = "../modules/ingress-static-ip"
  name                = local.name
  vpc_id              = module.network.vpc_id
  subnet_ids          = module.network.private_subnet_ids
  target_ips          = var.ingress_target_ips
  deletion_protection = var.deletion_protection
  tags                = local.tags
}

resource "aws_budgets_budget" "monthly" {
  count        = var.monthly_budget_usd != null && var.alarm_email != null ? 1 : 0
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alarm_email]
  }
}

module "observability" {
  source               = "../modules/observability"
  name                 = local.name
  region               = var.region
  lambda_function_name = module.lambda_api.function_name
  stage_name           = module.api_gateway.stage_name
  rds_proxy_name       = var.enable_rds_proxy ? local.name : null
  alarm_email          = var.alarm_email
  kms_key_arn          = aws_kms_key.ops.arn
  tags                 = local.tags
}
