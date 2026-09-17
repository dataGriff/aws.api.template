terraform {
  required_version = ">= 1.6"
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

output "state_bucket" { value = module.backend.state_bucket }
output "lock_table" { value = module.backend.lock_table }
