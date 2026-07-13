terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.53.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
  required_version = ">= 1.10"

  # Remote state. Create the bucket once by hand (see terraform/README.md),
  # then uncomment and run `terraform init -migrate-state`.
  #
  # backend "s3" {
  #   bucket       = "obsidian-terraform-state"   # bucket names are global — adjust if taken
  #   key          = "prod/terraform.tfstate"
  #   region       = "us-east-1"
  #   encrypt      = true
  #   use_lockfile = true                          # native S3 locking, no DynamoDB
  # }
}
