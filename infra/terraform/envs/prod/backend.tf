terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.60" }
  }
  # Remote state. bootstrap/ creates one isolated backend per env (bucket + KMS +
  # lock table), named from service_name + env (+ account). `task tf:plan`/`tf:apply`
  # recompute those names and pass bucket/region/dynamodb_table/kms_key_id as
  # -backend-config on every init, so nothing account-specific is committed.
  # kms_key_id MUST be supplied: the bucket policy rejects non-KMS writes.
  backend "s3" {
    key     = "prod/terraform.tfstate"
    encrypt = true
  }
}
