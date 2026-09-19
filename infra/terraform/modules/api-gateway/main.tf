terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.60" }
  }
}

locals {
  # Inject Lambda ARN, Cognito pool and CORS origin into the rendered contract.
  body = templatefile("${path.module}/openapi.gateway.yaml", {
    lambda_invoke_arn     = var.lambda_invoke_arn
    cognito_user_pool_arn = var.cognito_user_pool_arn
    cors_origin           = var.cors_origin
  })
}

data "aws_partition" "current" {}

resource "aws_api_gateway_rest_api" "this" {
  name = var.name
  body = local.body
  endpoint_configuration {
    types = ["REGIONAL"]
  }
  # With a custom domain in front, the default execute-api hostname is a second
  # front door that bypasses the domain's TLS policy and base-path mapping.
  disable_execute_api_endpoint = var.disable_execute_api_endpoint
  tags                         = var.tags
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  qualifier     = "live"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  triggers = {
    redeploy = sha1(jsonencode(local.body))
  }
  lifecycle {
    create_before_destroy = true
  }
}

# --- Access logging + account CloudWatch role --------------------------------
resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.name}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn
  tags              = var.tags
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["apigateway.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cloudwatch" {
  name_prefix        = "${var.name}-apigw-cw-"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "cloudwatch" {
  role       = aws_iam_role.cloudwatch.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}

# ONE per account+region. Several stacks in the same account/region must not
# all manage it (each apply would flip the role and a destroy would remove it
# from under the others): set manage_account_settings = true in exactly one.
resource "aws_api_gateway_account" "this" {
  count               = var.manage_account_settings ? 1 : 0
  cloudwatch_role_arn = aws_iam_role.cloudwatch.arn
}

resource "aws_api_gateway_stage" "this" {
  rest_api_id          = aws_api_gateway_rest_api.this.id
  deployment_id        = aws_api_gateway_deployment.this.id
  stage_name           = var.stage_name
  xray_tracing_enabled = true
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId          = "$context.requestId"
      ip                 = "$context.identity.sourceIp"
      httpMethod         = "$context.httpMethod"
      resourcePath       = "$context.resourcePath"
      status             = "$context.status"
      responseLatency    = "$context.responseLatency"
      integrationLatency = "$context.integrationLatency"
      integrationError   = "$context.integration.error"
      # Why the gateway itself rejected a request (authorizer, validator, WAF, throttle).
      errorType       = "$context.error.responseType"
      errorMessage    = "$context.error.message"
      authorizerError = "$context.authorizer.error"
      apiKeyId        = "$context.identity.apiKeyId"
      wafResponseCode = "$context.wafResponseCode"
    })
  }
  tags       = var.tags
  depends_on = [aws_api_gateway_account.this]
}

resource "aws_api_gateway_method_settings" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  stage_name  = aws_api_gateway_stage.this.stage_name
  method_path = "*/*"
  settings {
    metrics_enabled        = true
    logging_level          = "INFO"
    throttling_rate_limit  = var.throttle_rate
    throttling_burst_limit = var.throttle_burst
  }
}

# --- Consumer program: API key + usage plan ----------------------------------
resource "aws_api_gateway_api_key" "default" {
  name = "${var.name}-default"
  tags = var.tags
}

resource "aws_api_gateway_usage_plan" "default" {
  name = "${var.name}-default"
  api_stages {
    api_id = aws_api_gateway_rest_api.this.id
    stage  = aws_api_gateway_stage.this.stage_name
  }
  throttle_settings {
    rate_limit  = var.throttle_rate
    burst_limit = var.throttle_burst
  }
  quota_settings {
    limit  = var.quota_limit
    period = "DAY"
  }
  tags = var.tags
}

resource "aws_api_gateway_usage_plan_key" "default" {
  key_id        = aws_api_gateway_api_key.default.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.default.id
}
