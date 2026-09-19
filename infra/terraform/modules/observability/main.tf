terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.60" }
  }
}

# Alarms publish to the platform's shared topic (published at
# /platform/<env>/alarms/topic_arn); subscriptions live there.
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "${var.name}-lambda-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = var.lambda_function_name }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 5
  threshold           = var.error_threshold
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [var.alarm_topic_arn]
  treat_missing_data  = "notBreaching"
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  alarm_name          = "${var.name}-lambda-throttles"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = var.lambda_function_name }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 1
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [var.alarm_topic_arn]
  treat_missing_data  = "notBreaching"
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.name}-api-5xx"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5XXError"
  dimensions          = { ApiName = var.name, Stage = var.stage_name }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 5
  threshold           = var.error_threshold
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [var.alarm_topic_arn]
  treat_missing_data  = "notBreaching"
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "api_latency" {
  alarm_name          = "${var.name}-api-latency-p99"
  namespace           = "AWS/ApiGateway"
  metric_name         = "Latency"
  dimensions          = { ApiName = var.name, Stage = var.stage_name }
  extended_statistic  = "p99"
  period              = 60
  evaluation_periods  = 5
  threshold           = var.latency_p99_ms
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [var.alarm_topic_arn]
  treat_missing_data  = "notBreaching"
  tags                = var.tags
}

# Guards against RDS Proxy connection pinning silently disabling pooling.
resource "aws_cloudwatch_metric_alarm" "db_pinning" {
  count               = var.rds_proxy_name == null ? 0 : 1
  alarm_name          = "${var.name}-db-connection-pinning"
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnectionsCurrentlySessionPinned"
  dimensions          = { ProxyName = var.rds_proxy_name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  threshold           = var.pinning_threshold
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [var.alarm_topic_arn]
  treat_missing_data  = "notBreaching"
  tags                = var.tags
}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = var.name
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6,
        properties = {
          title  = "API requests / errors"
          region = var.region
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiName", var.name, "Stage", var.stage_name],
            ["AWS/ApiGateway", "4XXError", "ApiName", var.name, "Stage", var.stage_name],
            ["AWS/ApiGateway", "5XXError", "ApiName", var.name, "Stage", var.stage_name]
          ]
        }
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6,
        properties = {
          title  = "Lambda"
          region = var.region
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", var.lambda_function_name],
            ["AWS/Lambda", "Errors", "FunctionName", var.lambda_function_name],
            ["AWS/Lambda", "Duration", "FunctionName", var.lambda_function_name, { stat = "p99" }]
          ]
        }
      }
    ]
  })
}
