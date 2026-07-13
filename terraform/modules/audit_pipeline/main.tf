# Audit export: SQS FIFO -> Lambda -> S3 (docs/audit-pipeline.md).
# Prod twin of scripts/localstack/01-create-queues.sh + 02-deploy-lambda.sh —
# any setting changed here should be mirrored there so dev keeps parity.

data "aws_caller_identity" "current" {}

# ── Queues ───────────────────────────────────────────────────────────────────

resource "aws_sqs_queue" "dlq" {
  name       = "${var.name_prefix}-audit-export-dlq.fifo"
  fifo_queue = true

  # 14 days (the max): messages here are audit rows the pipeline failed on —
  # maximum time to notice the alarm and redrive before they're gone.
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "audit" {
  name       = "${var.name_prefix}-audit-export.fifo"
  fifo_queue = true

  # The shipper sets MessageDeduplicationId (audit row id) and MessageGroupId
  # (<table>:<record_id>) explicitly — content-based dedup must stay off.
  content_based_deduplication = false

  # Max retention: if the archiver is broken for a while, the queue copy may
  # outlive the Postgres copy (exported rows purge after 7 days).
  message_retention_seconds = 1209600

  # Must exceed the Lambda timeout (30s); AWS recommends ~6x.
  visibility_timeout_seconds = 180

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 5
  })
}

# Only the audit queue may use this DLQ as its redrive target.
resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.audit.arn]
  })
}

# ── Archive bucket ───────────────────────────────────────────────────────────

# Account id suffix: bucket names are global, this keeps the name deterministic
# without being squattable.
resource "aws_s3_bucket" "archive" {
  bucket = "${var.name_prefix}-audit-archive-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "archive" {
  bucket = aws_s3_bucket.archive.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "archive" {
  bucket = aws_s3_bucket.archive.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# No versioning: keys are deterministic and idempotent by design — a duplicate
# delivery overwrites an identical object (see lambda/audit-archiver/index.mjs).
# Add a lifecycle transition to Glacier here if storage cost ever matters.

# ── Lambda ───────────────────────────────────────────────────────────────────

# Same zip trick as dev: index.mjs only, no node_modules — nodejs20.x bundles
# AWS SDK v3.
data "archive_file" "archiver" {
  type        = "zip"
  source_file = "${var.lambda_source_dir}/index.mjs"
  output_path = "${path.module}/build/audit-archiver.zip"
}

resource "aws_iam_role" "archiver" {
  name = "${var.name_prefix}-audit-archiver"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# CloudWatch Logs write access, scoped to this function's log group by AWS.
resource "aws_iam_role_policy_attachment" "archiver_logs" {
  role       = aws_iam_role.archiver.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "archiver" {
  name = "archive-audit-messages"
  role = aws_iam_role.archiver.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ConsumeAuditQueue"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
        ]
        Resource = aws_sqs_queue.audit.arn
      },
      {
        Sid      = "WriteArchiveObjects"
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.archive.arn}/*"
      },
    ]
  })
}

# Pre-created so retention is controlled (Lambda would otherwise auto-create a
# never-expiring group on first invoke).
resource "aws_cloudwatch_log_group" "archiver" {
  name              = "/aws/lambda/${var.name_prefix}-audit-archiver"
  retention_in_days = 30
}

resource "aws_lambda_function" "archiver" {
  function_name = "${var.name_prefix}-audit-archiver"
  role          = aws_iam_role.archiver.arn

  filename         = data.archive_file.archiver.output_path
  source_code_hash = data.archive_file.archiver.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  architectures    = ["arm64"]
  timeout          = 30 # mirrors dev; queue visibility (180s) stays 6x this
  memory_size      = 128

  environment {
    variables = {
      AUDIT_BUCKET = aws_s3_bucket.archive.id
      # AWS_ENDPOINT_URL deliberately unset — real AWS (docs/environment.md)
    }
  }

  depends_on = [aws_cloudwatch_log_group.archiver]
}

resource "aws_lambda_event_source_mapping" "audit_to_archiver" {
  event_source_arn = aws_sqs_queue.audit.arn
  function_name    = aws_lambda_function.archiver.arn

  # batch 10 matches the shipper's SendMessageBatch size; per-message failure
  # reporting keeps FIFO group ordering while only failures retry.
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}
