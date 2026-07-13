variable "name_prefix" {
  description = "Prefix for resource names (project-environment)"
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
}

variable "subnet_id" {
  description = "Public subnet to launch into"
  type        = string
}

variable "security_group_id" {
  description = "API security group (CloudFront-only ingress)"
  type        = string
}

variable "app_secret_arn" {
  description = "Secrets Manager ARN holding the app runtime env"
  type        = string
}

variable "origin_verify_secret_arn" {
  description = "Secrets Manager ARN holding the X-Origin-Verify header value"
  type        = string
}

variable "audit_queue_arn" {
  description = "audit-export.fifo ARN (scopes the role's sqs:SendMessage)"
  type        = string
}

variable "audit_queue_url" {
  description = "audit-export.fifo URL (rendered into .env.docker.prod as SQS_AUDIT_QUEUE_URL)"
  type        = string
}

variable "repo_url" {
  description = "Git URL user-data clones to /opt/obsidian/app (empty = clone manually via SSM)"
  type        = string
  default     = ""
}

variable "data_volume_size" {
  description = "Size in GiB of the persistent EBS data volume"
  type        = number
  default     = 20
}
