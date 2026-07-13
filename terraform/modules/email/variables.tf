variable "name_prefix" {
  description = "Prefix for resource names (project-environment)"
  type        = string
}

variable "domain_name" {
  description = "Domain to verify as an SES sending identity"
  type        = string
}
