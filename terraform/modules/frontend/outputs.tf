output "distribution_id" {
  description = "CloudFront distribution id (needed for cache invalidation on deploy)"
  value       = aws_cloudfront_distribution.main.id
}

output "distribution_domain" {
  description = "*.cloudfront.net domain the Route 53 alias points at"
  value       = aws_cloudfront_distribution.main.domain_name
}

output "assets_bucket" {
  description = "S3 bucket name for the built frontend"
  value       = aws_s3_bucket.assets.id
}
