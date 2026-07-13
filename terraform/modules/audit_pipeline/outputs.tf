output "queue_arn" {
  description = "audit-export.fifo ARN (scoped into the EC2 role's sqs:SendMessage)"
  value       = aws_sqs_queue.audit.arn
}

output "queue_url" {
  description = "audit-export.fifo URL — goes in SQS_AUDIT_QUEUE_URL"
  value       = aws_sqs_queue.audit.url
}

output "dlq_name" {
  description = "DLQ name (monitoring alarms on its depth)"
  value       = aws_sqs_queue.dlq.name
}

output "lambda_name" {
  description = "Archiver Lambda name (monitoring alarms on its errors)"
  value       = aws_lambda_function.archiver.function_name
}

output "archive_bucket" {
  description = "S3 bucket receiving archived audit rows"
  value       = aws_s3_bucket.archive.id
}
