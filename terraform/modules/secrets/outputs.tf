output "app_secret_arn" {
  description = "ARN of the app runtime secret (read by the EC2 instance role)"
  value       = aws_secretsmanager_secret.app_env.arn
}

output "origin_verify_secret_arn" {
  description = "ARN of the X-Origin-Verify header secret"
  value       = aws_secretsmanager_secret.origin_verify.arn
}

output "origin_verify_value" {
  description = "The X-Origin-Verify header value (CloudFront custom origin header)"
  value       = random_password.origin_verify.result
  sensitive   = true
}
