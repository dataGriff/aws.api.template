terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.60" }
  }
}

# <service>.<base_domain> for this API, using the platform's wildcard
# certificate and hosted zone (published through the SSM interface). The
# certificate and zone are platform-owned; only the hostname is ours.
resource "aws_api_gateway_domain_name" "this" {
  domain_name              = var.hostname
  regional_certificate_arn = var.certificate_arn
  endpoint_configuration {
    types = ["REGIONAL"]
  }
  security_policy = "TLS_1_2"
  tags            = var.tags
}

resource "aws_api_gateway_base_path_mapping" "this" {
  api_id      = var.rest_api_id
  stage_name  = var.stage_name
  domain_name = aws_api_gateway_domain_name.this.domain_name
  base_path   = var.base_path
}

resource "aws_route53_record" "alias" {
  zone_id = var.hosted_zone_id
  name    = var.hostname
  type    = "A"
  alias {
    name                   = aws_api_gateway_domain_name.this.regional_domain_name
    zone_id                = aws_api_gateway_domain_name.this.regional_zone_id
    evaluate_target_health = false
  }
}
