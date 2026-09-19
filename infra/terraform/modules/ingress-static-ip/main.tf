terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.60" }
  }
}

# Ingress static IP for a DNS-fronted REST API. AWS Global Accelerator provides
# two static anycast IPs and fronts an internal NLB, which forwards to the
# private execute-api VPC endpoint ENIs (pass their private IPs as target_ips).
# This is the documented advanced path; see docs/architecture.
resource "aws_globalaccelerator_accelerator" "this" {
  name            = var.name
  ip_address_type = "IPV4"
  enabled         = true
  tags            = var.tags
}

# Internal NLB in front of the execute-api endpoint ENIs. Access logging is
# deliberately off: it needs an S3 bucket, and the API Gateway access log
# already records every request this NLB forwards.
# nosemgrep: terraform.aws.security.aws-elb-access-logs-not-enabled.aws-elb-access-logs-not-enabled
resource "aws_lb" "nlb" {
  name                             = substr("${var.name}-nlb", 0, 32)
  internal                         = true
  load_balancer_type               = "network"
  subnets                          = var.subnet_ids
  enable_cross_zone_load_balancing = true
  enable_deletion_protection       = var.deletion_protection
  tags                             = var.tags
}

resource "aws_lb_target_group" "this" {
  name        = substr("${var.name}-tg", 0, 32)
  port        = 443
  protocol    = "TCP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  # Fail fast instead of silently provisioning an Accelerator + NLB with zero
  # targets (which would blackhole all ingress). Supply the execute-api VPC
  # endpoint ENI private IPs — see docs/architecture.
  lifecycle {
    precondition {
      condition     = length(var.target_ips) > 0
      error_message = "ingress-static-ip requires target_ips (the private IPs of the execute-api VPC endpoint ENIs). See docs/architecture."
    }
  }
}

resource "aws_lb_target_group_attachment" "this" {
  for_each         = toset(var.target_ips)
  target_group_arn = aws_lb_target_group.this.arn
  target_id        = each.value
  port             = 443
}

resource "aws_lb_listener" "this" {
  load_balancer_arn = aws_lb.nlb.arn
  port              = 443
  protocol          = "TCP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
}

resource "aws_globalaccelerator_listener" "this" {
  accelerator_arn = aws_globalaccelerator_accelerator.this.id
  protocol        = "TCP"
  port_range {
    from_port = 443
    to_port   = 443
  }
}

resource "aws_globalaccelerator_endpoint_group" "this" {
  listener_arn = aws_globalaccelerator_listener.this.id
  endpoint_configuration {
    endpoint_id = aws_lb.nlb.arn
    weight      = 100
  }
}
