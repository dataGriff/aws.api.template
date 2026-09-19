terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.60" }
  }
}

resource "aws_wafv2_web_acl" "this" {
  name        = var.name
  scope       = "REGIONAL"
  description = "WAF for ${var.name}"

  default_action {
    allow {}
  }

  rule {
    name     = "rate-limit"
    priority = 1
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.rate_limit
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "common-rules"
    priority = 2
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-common"
      sampled_requests_enabled   = true
    }
  }

  # Request patterns known to be malicious, including Log4j JNDI lookups.
  rule {
    name     = "known-bad-inputs"
    priority = 3
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  # Source IPs with a bad reputation (bots, scanners, Tor exit nodes...).
  rule {
    name     = "ip-reputation"
    priority = 4
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = var.name
    sampled_requests_enabled   = true
  }

  tags = var.tags
}

resource "aws_wafv2_web_acl_association" "this" {
  resource_arn = var.stage_arn
  web_acl_arn  = aws_wafv2_web_acl.this.arn
}

# Full request logs for blocked/counted traffic (sampled requests alone only
# keep a 3-hour window). WAF requires the log group name to start with aws-waf-logs-.
resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-${var.name}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn
  tags              = var.tags
}

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  resource_arn            = aws_wafv2_web_acl.this.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
  redacted_fields {
    single_header {
      name = "authorization"
    }
  }
  redacted_fields {
    single_header {
      name = "x-api-key"
    }
  }
}
