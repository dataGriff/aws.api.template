terraform {
  required_providers {
    aws     = { source = "hashicorp/aws", version = ">= 5.60" }
    archive = { source = "hashicorp/archive", version = ">= 2.4" }
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
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
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "vpc" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "app" {
  statement {
    sid       = "Tracing"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }
  statement {
    sid       = "ReadSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.secret_arn]
  }
  dynamic "statement" {
    for_each = var.rds_proxy_resource_id == null ? [] : [1]
    content {
      sid       = "RdsIamConnect"
      actions   = ["rds-db:connect"]
      resources = ["arn:aws:rds-db:${var.region}:${local.account_id}:dbuser:${var.rds_proxy_resource_id}/${var.db_user}"]
    }
  }
  dynamic "statement" {
    for_each = var.idempotency_table_arn == null ? [] : [1]
    content {
      sid       = "Idempotency"
      actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"]
      resources = [var.idempotency_table_arn]
    }
  }
}

resource "aws_iam_role_policy" "app" {
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.app.json
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.name}-api"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

data "archive_file" "api" {
  type        = "zip"
  source_file = "${var.dist_dir}/handler.js"
  output_path = "${path.module}/.build/api.zip"
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

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_group_ids
  }

  tracing_config { mode = "Active" }

  environment {
    variables = merge({
      APP_ENV                      = var.env
      NODE_OPTIONS                 = "--enable-source-maps"
      POWERTOOLS_SERVICE_NAME      = var.name
      POWERTOOLS_METRICS_NAMESPACE = var.name
      DB_HOST                      = var.db_host
      DB_PORT                      = tostring(var.db_port)
      DB_NAME                      = var.db_name
      DB_USER                      = var.db_user
      DB_SSL                       = "true"
      DB_IAM_AUTH                  = var.rds_proxy_resource_id == null ? "false" : "true"
      DB_SECRET_ARN                = var.secret_arn
      IDEMPOTENCY_TABLE            = var.idempotency_table_name == null ? "" : var.idempotency_table_name
      NODE_EXTRA_CA_CERTS          = "/var/runtime/ca-cert.pem"
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
