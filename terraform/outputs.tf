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

output "distribution_id" {
  description = "CloudFront distribution id (cache invalidation on deploy)"
  value       = module.frontend.distribution_id
}

output "gha_plan_role_arn" {
  description = "Set as GitHub secret AWS_PLAN_ROLE_ARN"
  value       = module.cicd.plan_role_arn
}

output "gha_deploy_role_arn" {
  description = "Set as GitHub secret AWS_DEPLOY_ROLE_ARN"
  value       = module.cicd.deploy_role_arn
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

output "smtp_username" {
  description = "SES SMTP username — SMTP_USER in the app-env secret (read with: terraform output -raw smtp_username)"
  value       = module.email.smtp_username
  sensitive   = true
}

output "smtp_password" {
  description = "SES SMTP password — SMTP_PASS in the app-env secret (read with: terraform output -raw smtp_password)"
  value       = module.email.smtp_password
  sensitive   = true
}

output "alerts_topic_arn" {
  description = "SNS topic CloudWatch alarms publish to"
  value       = module.monitoring.sns_topic_arn
}
