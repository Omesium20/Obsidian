output "smtp_username" {
  description = "SES SMTP username (IAM access key id) — goes into the app secret as SMTP_USER"
  value       = aws_iam_access_key.smtp.id
  sensitive   = true
}

output "smtp_password" {
  description = "SES SMTP password (SigV4-derived) — goes into the app secret as SMTP_PASS"
  value       = aws_iam_access_key.smtp.ses_smtp_password_v4
  sensitive   = true
}

output "smtp_endpoint" {
  description = "SMTP_HOST value for the app secret"
  value       = "email-smtp.${data.aws_region.current.region}.amazonaws.com"
}

output "hosted_zone_id" {
  description = "Route 53 hosted zone id for the domain"
  value       = data.aws_route53_zone.main.zone_id
}
