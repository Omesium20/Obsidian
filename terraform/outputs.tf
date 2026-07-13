output "vpc_id" {
  description = "VPC id"
  value       = module.network.vpc_id
}

output "public_subnet_id" {
  description = "Public subnet hosting the EC2 instance"
  value       = module.network.public_subnet_id
}

output "api_security_group_id" {
  description = "Security group on the API instance (CloudFront-only ingress)"
  value       = module.network.api_security_group_id
}

output "instance_id" {
  description = "EC2 instance id (connect with: aws ssm start-session --target <id>)"
  value       = module.compute.instance_id
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain (obsidian-secured.com aliases to this)"
  value       = module.frontend.distribution_domain
}

output "assets_bucket" {
  description = "S3 bucket for the built frontend (sync dist/ here on deploy)"
  value       = module.frontend.assets_bucket
}

output "audit_queue_url" {
  description = "SQS FIFO queue URL — goes in SQS_AUDIT_QUEUE_URL"
  value       = module.audit_pipeline.queue_url
}

output "audit_archive_bucket" {
  description = "S3 bucket receiving archived audit rows"
  value       = module.audit_pipeline.archive_bucket
}

output "alerts_topic_arn" {
  description = "SNS topic CloudWatch alarms publish to"
  value       = module.monitoring.sns_topic_arn
}
