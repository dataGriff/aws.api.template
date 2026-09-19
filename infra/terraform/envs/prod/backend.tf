terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.60" }
  }
  # Remote state. The bucket/table/key are created once by bootstrap/ (modules/tf-backend).
  # CI passes -backend-config for bucket/region/kms_key_id via TF_CLI_ARGS_init;
  # locally export TF_STATE_BUCKET (and TF_STATE_KMS_KEY_ARN). key is per-env.
  # kms_key_id MUST be supplied: the bucket policy rejects non-KMS writes.
  backend "s3" {
    key            = "prod/terraform.tfstate"
    dynamodb_table = "terraform-locks"
    encrypt        = true
  }
}
