# CloudWatch alarms -> SNS -> email (design agreed in chat: plain SNS, no SES
# hop). Every alarm also notifies on OK so recoveries don't need the console.

data "aws_region" "current" {}
data "aws_partition" "current" {}

# ── Alerts topic ─────────────────────────────────────────────────────────────

resource "aws_sns_topic" "alerts" {
  name = "${var.name_prefix}-alerts"
}

# Stays "pending confirmation" until the link in AWS's email is clicked —
# alarms are silent until then (docs/terraform.md bootstrap list).
resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

locals {
  notify = [aws_sns_topic.alerts.arn]
}

# ── Container log groups (awslogs driver targets, docker-compose.prod.yaml) ──

resource "aws_cloudwatch_log_group" "containers" {
  for_each = toset(var.container_services)

  name              = "/${var.name_prefix}/${each.key}"
  retention_in_days = 30
}

# ── Instance health ──────────────────────────────────────────────────────────

# Hardware/hypervisor failure: alarm AND auto-recover (stop/start onto healthy
# hardware, keeping instance id, EIP association, and EBS attachments).
resource "aws_cloudwatch_metric_alarm" "status_check_system" {
  alarm_name          = "${var.name_prefix}-ec2-system-check"
  alarm_description   = "EC2 system status check failing - underlying hardware problem; auto-recover attempts a migration"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  dimensions          = { InstanceId = var.instance_id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"

  alarm_actions = concat(local.notify, [
    "arn:${data.aws_partition.current.partition}:automate:${data.aws_region.current.region}:ec2:recover",
  ])
  ok_actions = local.notify
}

# OS-level failure (kernel panic, exhausted memory, misconfigured network) —
# recover can't fix these; a human (or a reboot) has to.
resource "aws_cloudwatch_metric_alarm" "status_check_instance" {
  alarm_name          = "${var.name_prefix}-ec2-instance-check"
  alarm_description   = "EC2 instance status check failing - OS-level problem on the box"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_Instance"
  dimensions          = { InstanceId = var.instance_id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"

  alarm_actions = local.notify
  ok_actions    = local.notify
}

# ── Per-container health (Obsidian/Containers, published by the on-box timer
# installed in compute's user-data) ──────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "container_healthy" {
  for_each = toset(var.container_services)

  alarm_name          = "${var.name_prefix}-container-${each.key}"
  alarm_description   = "The ${each.key} container has not been healthy for 3 minutes (compose healthcheck failing, container gone, or the box/timer is dead)"
  namespace           = "Obsidian/Containers"
  metric_name         = "ContainerHealthy"
  dimensions          = { Service = each.key }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  # Missing data = the publisher itself died (box down, timer broken, IAM
  # revoked). A monitoring gap must page, never silence.
  treat_missing_data = "breaching"

  alarm_actions = local.notify
  ok_actions    = local.notify
}

# ── Resource headroom (CWAgent metrics from compute's agent config) ──────────

resource "aws_cloudwatch_metric_alarm" "memory" {
  alarm_name          = "${var.name_prefix}-memory"
  alarm_description   = "Memory above 90% for 15 minutes on the app node"
  namespace           = "CWAgent"
  metric_name         = "mem_used_percent"
  dimensions          = { InstanceId = var.instance_id }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 90
  treat_missing_data  = "notBreaching" # container alarm already catches a dead publisher

  alarm_actions = local.notify
  ok_actions    = local.notify
}

# Aggregated InstanceId+path series (agent's aggregation_dimensions) — no
# fragile device/fstype dimensions.
resource "aws_cloudwatch_metric_alarm" "disk" {
  for_each = toset(["/", "/opt/obsidian"])

  alarm_name          = "${var.name_prefix}-disk-${each.key == "/" ? "root" : "data"}"
  alarm_description   = "Filesystem ${each.key} above 80% - docker images/logs (root) or repo growth (data)"
  namespace           = "CWAgent"
  metric_name         = "disk_used_percent"
  dimensions          = { InstanceId = var.instance_id, path = each.key }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  treat_missing_data  = "notBreaching"

  alarm_actions = local.notify
  ok_actions    = local.notify
}

# ── Audit pipeline ───────────────────────────────────────────────────────────

# Anything in the DLQ means audit rows failed archiving 5 times — investigate
# and redrive before the 14-day retention runs out.
resource "aws_cloudwatch_metric_alarm" "audit_dlq" {
  alarm_name          = "${var.name_prefix}-audit-dlq"
  alarm_description   = "Messages in the audit dead-letter queue - the archiver gave up on them"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = var.audit_dlq_name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = local.notify
  ok_actions    = local.notify
}

resource "aws_cloudwatch_metric_alarm" "archiver_errors" {
  alarm_name          = "${var.name_prefix}-audit-archiver-errors"
  alarm_description   = "The audit archiver Lambda is throwing (whole-invoke failures, not per-message retries)"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = var.lambda_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  alarm_actions = local.notify
  ok_actions    = local.notify
}
