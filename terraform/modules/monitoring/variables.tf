variable "name_prefix" {
  description = "Prefix for resource names (project-environment)"
  type        = string
}

variable "alert_email" {
  description = "Email address subscribed to the alerts topic"
  type        = string
}

variable "instance_id" {
  description = "EC2 instance the status-check alarms watch"
  type        = string
}

variable "container_services" {
  description = "Compose service names reporting ContainerHealthy metrics"
  type        = list(string)
}

variable "audit_dlq_name" {
  description = "Audit DLQ name (alarm on visible messages)"
  type        = string
}

variable "lambda_name" {
  description = "Audit archiver Lambda name (alarm on errors)"
  type        = string
}
