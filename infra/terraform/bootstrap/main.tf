terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.60" }
  }
  # Uses a local backend — this creates the remote backend the envs then use.
}

provider "aws" {
  region = var.region
}

module "backend" {
  source       = "../modules/tf-backend"
  state_bucket = var.state_bucket
  lock_table   = var.lock_table
  tags         = { ManagedBy = "terraform", Purpose = "tf-backend" }
}

# --- GitHub Actions OIDC: the deploy trust boundary, in code ------------------
# One role per environment. GitHub's OIDC token `sub` for a job running under a
# GitHub Environment is `repo:<owner>/<repo>:environment:<name>`, so a role can
# only be assumed by THIS repository, from a job bound to THAT environment
# (which is where the protection rules / required reviewers live). Nothing else
# — not a fork, not another branch without the environment — matches.
data "aws_partition" "current" {}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc ? 1 : 0
  url   = "https://token.actions.githubusercontent.com"
  # GitHub's provider is validated by AWS via its trusted root CAs; the
  # thumbprint is still required by the API.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
  client_id_list  = ["sts.amazonaws.com"]
  tags            = var.tags
}

data "aws_iam_policy_document" "github_trust" {
  for_each = var.create_github_oidc ? toset(var.deploy_environments) : toset([])
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github[0].arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:${each.key}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  for_each             = data.aws_iam_policy_document.github_trust
  name                 = "${var.deploy_role_prefix}-${each.key}"
  assume_role_policy   = each.value.json
  max_session_duration = 3600
  tags                 = merge(var.tags, { Environment = each.key })
}

# The deploy role creates IAM roles, KMS keys, VPCs, RDS, Cognito... so it needs
# broad rights. Scope it down to your account's needs (or add a permissions
# boundary) once the resource set is known; the trust policy above is what keeps
# it from being assumed by anyone but the intended workflow.
resource "aws_iam_role_policy_attachment" "deploy" {
  for_each   = aws_iam_role.deploy
  role       = each.value.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AdministratorAccess"
}

# The state bucket is shared by all envs; every deploy role needs it.
data "aws_iam_policy_document" "state_access" {
  statement {
    actions   = ["s3:ListBucket"]
    resources = [module.backend.state_bucket_arn]
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${module.backend.state_bucket_arn}/*"]
  }
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
    resources = [module.backend.lock_table_arn]
  }
  statement {
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]
    resources = [module.backend.kms_key_arn]
  }
}

resource "aws_iam_role_policy" "state_access" {
  for_each = aws_iam_role.deploy
  name     = "terraform-state"
  role     = each.value.id
  policy   = data.aws_iam_policy_document.state_access.json
}

variable "region" {
  type    = string
  default = "eu-west-2"
}
variable "state_bucket" {
  type        = string
  description = "Globally-unique S3 bucket name for Terraform state"
}
variable "lock_table" {
  type    = string
  default = "terraform-locks"
}
variable "create_github_oidc" {
  type        = bool
  default     = true
  description = "Create the GitHub OIDC provider + per-environment deploy roles (set false if the account already has the provider)."
}
variable "github_repository" {
  type        = string
  default     = "dataGriff/aws.api.template"
  description = "owner/repo allowed to assume the deploy roles"
}
variable "deploy_environments" {
  type    = list(string)
  default = ["dev", "staging", "prod"]
}
variable "deploy_role_prefix" {
  type    = string
  default = "github-deploy"
}
variable "tags" {
  type    = map(string)
  default = { ManagedBy = "terraform", Purpose = "tf-bootstrap" }
}

output "state_bucket" { value = module.backend.state_bucket }
output "lock_table" { value = module.backend.lock_table }
output "state_kms_key_arn" { value = module.backend.kms_key_arn }
output "deploy_role_arns" {
  description = "Set each as AWS_DEPLOY_ROLE_ARN on the matching GitHub Environment"
  value       = { for k, r in aws_iam_role.deploy : k => r.arn }
}
