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

data "aws_caller_identity" "current" {}

# One isolated state backend per environment: its own S3 bucket, KMS key and
# lock table, named <service>-tfstate-<env>-<account> / <service>-tflock-<env> /
# alias/<service>-tfstate-<env>. Deriving the names means a deploy only needs the
# service + env (no hand-picked globally-unique bucket), and each env's deploy
# role is scoped to ONLY its own backend below — dev cannot read or write
# staging/prod state.
module "backend" {
  source       = "../modules/tf-backend"
  for_each     = toset(var.deploy_environments)
  state_bucket = "${var.service_name}-tfstate-${each.key}-${data.aws_caller_identity.current.account_id}"
  lock_table   = "${var.service_name}-tflock-${each.key}"
  kms_alias    = "${var.service_name}-tfstate-${each.key}"
  tags         = { ManagedBy = "terraform", Purpose = "tf-backend", Environment = each.key }
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

# Each env's deploy role can touch ONLY its own env's state backend (bucket,
# lock table and KMS key). This is the isolation the per-env split buys us.
data "aws_iam_policy_document" "state_access" {
  for_each = aws_iam_role.deploy
  statement {
    actions   = ["s3:ListBucket"]
    resources = [module.backend[each.key].state_bucket_arn]
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${module.backend[each.key].state_bucket_arn}/*"]
  }
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
    resources = [module.backend[each.key].lock_table_arn]
  }
  statement {
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]
    resources = [module.backend[each.key].kms_key_arn]
  }
}

resource "aws_iam_role_policy" "state_access" {
  for_each = aws_iam_role.deploy
  name     = "terraform-state"
  role     = each.value.id
  policy   = data.aws_iam_policy_document.state_access[each.key].json
}

variable "region" {
  type    = string
  default = "eu-west-2"
}
variable "service_name" {
  type        = string
  default     = "todo-api"
  description = "Base name for the per-env state backends (must match the envs' service_name). Bucket/lock/KMS-alias names are derived from it, so no globally-unique bucket name is chosen by hand."
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

# Names are derived and recomputed by the deploy tasks — these outputs are for
# reference/verification, not something you copy into GitHub secrets.
output "state_buckets" { value = { for k, m in module.backend : k => m.state_bucket } }
output "lock_tables" { value = { for k, m in module.backend : k => m.lock_table } }
output "state_kms_aliases" { value = { for k, m in module.backend : k => m.kms_alias } }
output "deploy_role_arns" {
  description = "Set each env's value as AWS_DEPLOY_ROLE_ARN on the matching GitHub Environment (the only per-env secret needed)"
  value       = { for k, r in aws_iam_role.deploy : k => r.arn }
}
