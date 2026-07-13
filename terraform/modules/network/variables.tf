variable "name_prefix" {
  description = "Prefix for resource names (project-environment)"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block (/24)"
  type        = string
}

variable "api_port" {
  description = "Backend port CloudFront connects to"
  type        = number
}
