variable "aws_region" {
  description = "AWS region for all resources (CloudFront ACM certs require us-east-1)"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project slug used in resource names and tags"
  type        = string
  default     = "obsidian"
}

variable "environment" {
  description = "Environment slug used in resource names and tags"
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "VPC CIDR block (/24 — the public subnet takes the first /26, the rest is headroom)"
  type        = string
  default     = "10.0.0.0/24"
}

variable "instance_type" {
  description = "EC2 instance type for the single app node (ARM — the Dockerfile builds on arm64)"
  type        = string
  default     = "t4g.small"
}

variable "api_port" {
  description = "Port the backend container publishes; CloudFront's /api/* origin target"
  type        = number
  default     = 3000
}

variable "domain_name" {
  description = "Apex domain (Route 53 hosted zone) fronting CloudFront and verifying SES"
  type        = string
  default     = "obsidian-secured.com"
}

variable "github_repo" {
  description = "GitHub org/repo for the CI OIDC trust conditions"
  type        = string
  default     = "Omesium20/Obsidian"
}

variable "repo_url" {
  description = "Git URL the instance clones on first boot (empty = clone manually via SSM)"
  type        = string
  default     = ""
}

variable "alert_email" {
  description = "Email address subscribed to the CloudWatch alarm SNS topic"
  type        = string
}
