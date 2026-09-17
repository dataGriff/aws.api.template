terraform {
  required_version = ">= 1.6"
  # Remote state. The bucket/table are created once by modules/tf-backend.
  # CI passes -backend-config for bucket/region; key is per-env.
  backend "s3" {
    key            = "prod/terraform.tfstate"
    dynamodb_table = "terraform-locks"
    encrypt        = true
  }
}
