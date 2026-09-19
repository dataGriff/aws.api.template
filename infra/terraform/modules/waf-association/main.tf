terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.60" }
  }
}

# The web ACL is platform-owned (one per environment, shared by every API);
# this API only attaches its stage to it.
resource "aws_wafv2_web_acl_association" "this" {
  resource_arn = var.stage_arn
  web_acl_arn  = var.web_acl_arn
}
