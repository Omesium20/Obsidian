#!/bin/bash
# Runs after 01-create-queues.sh (ready.d is lexicographic). Provisions the
# downstream half of the pipeline: the S3 archive bucket, the audit-archiver
# Lambda, and the SQS -> Lambda event-source mapping.
set -euo pipefail

ACCOUNT="000000000000"
BUCKET="obsidian-audit"
FN="audit-archiver"
SRC="/opt/code/audit-archiver" # bind-mounted handler source (compose)
ZIP="/tmp/${FN}.zip"

# --- S3 bucket: archive destination ------------------------------------------
awslocal s3 mb "s3://${BUCKET}"

# --- Package + deploy the Lambda ---------------------------------------------
# Deploy via a self-contained --zip-file rather than a hot-reload code mount.
# LocalStack runs Lambdas as SIBLING containers through the host Docker socket,
# so a mounted code path (valid inside this container) wouldn't exist on the host
# and the runtime would find an empty /var/task. Zipping the handler here and
# shipping the bytes sidesteps that path mismatch. We zip with python3 (always
# present in the LocalStack image) to avoid assuming `zip` is installed. The
# nodejs20.x runtime bundles AWS SDK v3, so index.mjs's @aws-sdk/client-s3 import
# needs no node_modules in the zip.
( cd "${SRC}" && python3 -m zipfile -c "${ZIP}" index.mjs )

awslocal lambda create-function \
  --function-name "${FN}" \
  --runtime nodejs20.x \
  --handler index.handler \
  --role "arn:aws:iam::${ACCOUNT}:role/lambda-role" \
  --timeout 30 \
  --environment "Variables={AUDIT_BUCKET=${BUCKET}}" \
  --zip-file "fileb://${ZIP}"

awslocal lambda wait function-active-v2 --function-name "${FN}"

# --- Wire the FIFO queue to the Lambda ---------------------------------------
QUEUE_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "http://localhost:4566/${ACCOUNT}/audit-export.fifo" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' --output text)

# batch-size 10 matches the shipper's SendMessageBatch size. ReportBatchItemFailures
# lets the handler fail individual messages: those stay in flight to retry and,
# after the queue's maxReceiveCount (5), are redriven to audit-export-dlq.fifo;
# the rest of the batch is deleted.
awslocal lambda create-event-source-mapping \
  --function-name "${FN}" \
  --event-source-arn "${QUEUE_ARN}" \
  --batch-size 10 \
  --function-response-types ReportBatchItemFailures

echo "[localstack-init] Deployed ${FN} -> s3://${BUCKET}, wired to audit-export.fifo"
