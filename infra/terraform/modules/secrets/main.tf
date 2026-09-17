terraform {
  required_providers {
    aws    = { source = "hashicorp/aws", version = ">= 5.60" }
    random = { source = "hashicorp/random", version = ">= 3.6" }
  }
}

resource "random_password" "db" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}"
}

resource "aws_secretsmanager_secret" "db" {
  name                    = "${var.name}/db"
  description             = "Database credentials for ${var.name}"
  kms_key_id              = var.kms_key_id
  recovery_window_in_days = var.recovery_window_in_days
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    username = var.username
    password = random_password.db.result
  })
}

# Rotation is opt-in. Supply a rotation Lambda ARN to enable automatic rotation;
# prefer RDS Proxy IAM auth to minimise standing credentials.
resource "aws_secretsmanager_secret_rotation" "db" {
  count               = var.rotation_lambda_arn == null ? 0 : 1
  secret_id           = aws_secretsmanager_secret.db.id
  rotation_lambda_arn = var.rotation_lambda_arn
  rotation_rules {
    automatically_after_days = var.rotation_days
  }
}
