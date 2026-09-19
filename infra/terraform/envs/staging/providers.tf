provider "aws" {
  region              = var.region
  allowed_account_ids = var.allowed_account_ids
  default_tags {
    tags = {
      Service     = var.service_name
      Environment = "staging"
      ManagedBy   = "terraform"
    }
  }
}
