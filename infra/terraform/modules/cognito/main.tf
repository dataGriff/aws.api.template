terraform {
  required_version = ">= 1.9"
  required_providers {
    aws     = { source = "hashicorp/aws", version = ">= 5.60" }
    archive = { source = "hashicorp/archive", version = ">= 2.4" }
  }
}

data "aws_partition" "current" {}

# --- Pre-token-generation trigger Lambda ------------------------------------
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "pretoken" {
  name_prefix        = "${var.name}-pretoken-"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "pretoken_logs" {
  role       = aws_iam_role.pretoken.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Managed explicitly so retention is bounded (an auto-created group never expires).
resource "aws_cloudwatch_log_group" "pretoken" {
  name              = "/aws/lambda/${var.name}-pretoken"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

data "archive_file" "pretoken" {
  type        = "zip"
  source_file = "${var.pretoken_dist_dir}/handler.js"
  output_path = "${path.module}/.build/${var.name}-pretoken.zip"
}

resource "aws_lambda_function" "pretoken" {
  function_name    = "${var.name}-pretoken"
  role             = aws_iam_role.pretoken.arn
  runtime          = "nodejs22.x"
  handler          = "handler.handler"
  filename         = data.archive_file.pretoken.output_path
  source_code_hash = data.archive_file.pretoken.output_base64sha256
  timeout          = 5
  memory_size      = 128
  architectures    = ["arm64"]
  environment {
    variables = { NODE_OPTIONS = "--enable-source-maps" }
  }
  depends_on = [aws_cloudwatch_log_group.pretoken]
  tags       = var.tags
}

resource "aws_lambda_permission" "cognito" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pretoken.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.this.arn
}

# --- User pool ---------------------------------------------------------------
resource "aws_cognito_user_pool" "this" {
  name = var.name

  # The user directory is the one thing that cannot be rebuilt from code. With
  # protection ACTIVE, both `terraform destroy` and a ForceNew replacement
  # (e.g. editing the `schema` block below) are refused by the service.
  deletion_protection = var.deletion_protection ? "ACTIVE" : "INACTIVE"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }

  # TOTP MFA available to every user; enforce with "ON" once clients support it.
  mfa_configuration = var.mfa_configuration
  software_token_mfa_configuration {
    enabled = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Compromised-credential and adaptive-auth detection. OFF by default because
  # AUDIT/ENFORCED require the Plus feature plan (billed per MAU).
  user_pool_add_ons {
    advanced_security_mode = var.advanced_security_mode
  }

  # NOTE: any change to this block forces replacement of the pool (see
  # deletion_protection above).
  schema {
    name                     = "tenant_id"
    attribute_data_type      = "String"
    mutable                  = true
    developer_only_attribute = false
    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  lambda_config {
    pre_token_generation_config {
      lambda_arn     = aws_lambda_function.pretoken.arn
      lambda_version = "V2_0"
    }
  }

  tags = var.tags
}

resource "aws_cognito_user_pool_domain" "this" {
  domain       = "${var.name}-${var.domain_suffix}"
  user_pool_id = aws_cognito_user_pool.this.id
}

resource "aws_cognito_user_group" "admin" {
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.this.id
  description  = "Administrators (cross-user operations)"
}

# Public app client (Authorization Code + PKCE for user-facing apps).
resource "aws_cognito_user_pool_client" "app" {
  name                                 = "${var.name}-app"
  user_pool_id                         = aws_cognito_user_pool.this.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = var.callback_urls
  logout_urls                          = var.logout_urls
  supported_identity_providers         = ["COGNITO"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]
  # Generic errors for unknown users so the login form cannot enumerate accounts.
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  access_token_validity         = 60
  id_token_validity             = 60
  refresh_token_validity        = var.refresh_token_validity_days
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

# Test client allowing USER_PASSWORD_AUTH so CI/Schemathesis can mint tokens.
# Password auth is a credential-stuffing surface: keep this off outside dev/staging.
resource "aws_cognito_user_pool_client" "test" {
  count                         = var.enable_test_client ? 1 : 0
  name                          = "${var.name}-test"
  user_pool_id                  = aws_cognito_user_pool.this.id
  generate_secret               = false
  explicit_auth_flows           = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  access_token_validity         = 60
  refresh_token_validity        = 1
  token_validity_units {
    access_token  = "minutes"
    refresh_token = "days"
  }
}
