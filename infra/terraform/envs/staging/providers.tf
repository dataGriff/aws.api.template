provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Service     = var.service_name
      Environment = "staging"
      ManagedBy   = "terraform"
    }
  }
}
