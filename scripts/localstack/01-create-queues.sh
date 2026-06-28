#!/bin/bash
# LocalStack runs every executable in /etc/localstack/init/ready.d once the
# emulator is ready. This provisions the audit-export FIFO queue + its FIFO
# dead-letter queue so the dev stack mirrors prod: shipper -> audit-export.fifo
# -> Lambda -> S3, with messages Lambda can't process redriven to the DLQ.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
ACCOUNT="000000000000" # LocalStack's fixed account id

# --- Dead-letter queue (FIFO) -------------------------------------------------
awslocal sqs create-queue \
  --queue-name audit-export-dlq.fifo \
  --attributes FifoQueue=true

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "http://localhost:4566/${ACCOUNT}/audit-export-dlq.fifo" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' --output text)

# --- Main queue (FIFO) with redrive to the DLQ --------------------------------
# maxReceiveCount=5: after 5 failed Lambda processing attempts a message moves to
# the DLQ. No ContentBasedDeduplication — the shipper sets MessageDeduplicationId
# explicitly (the audit row id).
REDRIVE_POLICY="{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"5\"}"

awslocal sqs create-queue \
  --queue-name audit-export.fifo \
  --attributes "{\"FifoQueue\":\"true\",\"RedrivePolicy\":\"$(echo "$REDRIVE_POLICY" | sed 's/"/\\"/g')\"}"

echo "[localstack-init] Created audit-export.fifo (+ audit-export-dlq.fifo) in ${REGION}"
