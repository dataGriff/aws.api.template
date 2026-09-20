terraform {
  required_version = ">= 1.9"
  required_providers {
    aws     = { source = "hashicorp/aws", version = ">= 5.60" }
    archive = { source = "hashicorp/archive", version = ">= 2.4" }
  }
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  # Reported by GET /health so a deploy can be verified end to end.
  service_version = substr(data.archive_file.api.output_md5, 0, 12)
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name_prefix        = "${var.name}-api-"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  # Required by the platform: the service deploy role may only create roles that
  # carry its workload boundary (see aws.infra.template docs/security).
  permissions_boundary = var.permissions_boundary_arn
  tags                 = var.tags
}

resource "aws_iam_role_policy_attachment" "vpc" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "app" {
  statement {
    sid       = "Tracing"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }
  # NOTE: conditions on these blocks use KNOWN booleans. ARNs/ids of resources
  # created in the same apply are unknown at plan time, and count/for_each
  # cannot depend on them ("Invalid for_each argument" on a first apply).
  statement {
    sid       = "ReadSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.secret_arn]
  }
  dynamic "statement" {
    for_each = var.rds_iam_auth ? [1] : []
    content {
      sid       = "RdsIamConnect"
      actions   = ["rds-db:connect"]
      resources = ["arn:${local.partition}:rds-db:${var.region}:${local.account_id}:dbuser:${var.rds_proxy_resource_id}/${var.db_user}"]
    }
  }
  statement {
    sid       = "Idempotency"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"]
    resources = [var.idempotency_table_arn]
  }
  # Decrypt the CMK-encrypted secret / DynamoDB table (data key) and the
  # function's own environment variables (ops key).
  statement {
    sid       = "Kms"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
    resources = [var.data_kms_key_arn, var.kms_key_arn]
  }
}

resource "aws_iam_role_policy" "app" {
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.app.json
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.name}-api"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn
  tags              = var.tags
}

data "archive_file" "api" {
  type        = "zip"
  source_file = "${var.dist_dir}/handler.js"
  # Per-stack path so concurrent plans of two envs from one checkout don't clobber each other.
  output_path = "${path.module}/.build/${var.name}-api.zip"
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.name}-api"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs22.x"
  handler          = "handler.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  timeout          = 15
  memory_size      = var.memory_size
  architectures    = ["arm64"]
  publish          = true
  # Caps how many connections a burst can open against the DB/proxy and stops
  # this function starving the account's concurrency pool. -1 = unreserved.
  reserved_concurrent_executions = var.reserved_concurrency
  # Environment variables (DB host, secret ARN...) encrypted with our CMK at rest.
  kms_key_arn = var.kms_key_arn

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_group_ids
  }

  tracing_config { mode = "Active" }

  environment {
    variables = merge({
      APP_ENV                      = var.env
      SERVICE_VERSION              = local.service_version
      NODE_OPTIONS                 = "--enable-source-maps"
      POWERTOOLS_SERVICE_NAME      = var.name
      POWERTOOLS_METRICS_NAMESPACE = var.name
      DB_HOST                      = var.db_host
      DB_PORT                      = tostring(var.db_port)
      DB_NAME                      = var.db_name
      DB_USER                      = var.db_user
      DB_SSL                       = "true"
      DB_IAM_AUTH                  = var.rds_iam_auth ? "true" : "false"
      DB_SECRET_ARN                = var.secret_arn
      IDEMPOTENCY_TABLE            = var.idempotency_table_name
    }, var.extra_environment)
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
  tags       = var.tags
}

resource "aws_lambda_alias" "live" {
  name             = "live"
  function_name    = aws_lambda_function.api.function_name
  function_version = aws_lambda_function.api.version
}
