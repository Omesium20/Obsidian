variable "name_prefix" {
  description = "Prefix for resource names (project-environment)"
  type        = string
}

variable "domain_name" {
  description = "Apex domain served by the distribution (Route 53 hosted zone)"
  type        = string
}

variable "api_origin_domain" {
  description = "EC2 public DNS name for the /api/* origin"
  type        = string
}

variable "api_origin_port" {
  description = "Port CloudFront connects to on the API origin"
  type        = number
}

variable "origin_verify_value" {
  description = "Shared secret injected as the X-Origin-Verify origin header"
  type        = string
  sensitive   = true
}
