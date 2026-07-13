# The single app node (docs/deployment.md): one EC2 instance running the prod
# compose stack (backend, scheduler, redis), bootstrapped by user-data.

data "aws_partition" "current" {}
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

data "aws_ami" "al2023_arm64" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023*-arm64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

locals {
  # docker compose CLI plugin — AL2023 packages docker but not compose.
  compose_version = "v2.29.7"

  log_group_arn_prefix = "arn:${data.aws_partition.current.partition}:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:log-group:/${var.name_prefix}/*"
}

# ── IAM: instance role ───────────────────────────────────────────────────────

resource "aws_iam_role" "instance" {
  name = "${var.name_prefix}-app-node"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Admin access is SSM Session Manager — this is what replaces port 22.
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "app_node" {
  name = "app-node-runtime"
  role = aws_iam_role.instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ShipAuditRows"
        Effect   = "Allow"
        Action   = "sqs:SendMessage"
        Resource = var.audit_queue_arn
      },
      {
        Sid    = "ReadAppSecrets"
        Effect = "Allow"
        Action = "secretsmanager:GetSecretValue"
        Resource = [
          var.app_secret_arn,
          var.origin_verify_secret_arn,
        ]
      },
      {
        Sid      = "PublishHealthAndAgentMetrics"
        Effect   = "Allow"
        Action   = "cloudwatch:PutMetricData"
        Resource = "*" # PutMetricData does not support resource scoping
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = ["Obsidian/Containers", "CWAgent"]
          }
        }
      },
      {
        # For the awslogs docker logging driver (log groups /<name_prefix>/*).
        Sid    = "ShipContainerLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = [
          local.log_group_arn_prefix,
          "${local.log_group_arn_prefix}:*",
        ]
      },
    ]
  })
}

resource "aws_iam_instance_profile" "instance" {
  name = "${var.name_prefix}-app-node"
  role = aws_iam_role.instance.name
}

# ── The instance ─────────────────────────────────────────────────────────────

resource "aws_instance" "app" {
  ami                    = data.aws_ami.al2023_arm64.id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [var.security_group_id]
  iam_instance_profile   = aws_iam_instance_profile.instance.name

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required" # IMDSv2 only
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 16
    encrypted   = true
  }

  user_data = templatefile("${path.module}/templates/user_data.sh.tftpl", {
    name_prefix              = var.name_prefix
    app_secret_arn           = var.app_secret_arn
    origin_verify_secret_arn = var.origin_verify_secret_arn
    audit_queue_url          = var.audit_queue_url
    aws_region               = data.aws_region.current.region
    repo_url                 = var.repo_url
    compose_version          = local.compose_version
  })

  lifecycle {
    # A new AL2023 AMI release must not replace the box on the next apply.
    ignore_changes = [ami]
  }

  tags = {
    Name = "${var.name_prefix}-app"
  }
}

# Stable address: CloudFront's /api/* origin is this EIP's public DNS name —
# an ephemeral IP would break the origin on every stop/start.
resource "aws_eip" "app" {
  domain = "vpc"

  tags = {
    Name = "${var.name_prefix}-app"
  }
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}

# ── Persistent data volume (repo checkout + rendered env), /opt/obsidian ─────

resource "aws_ebs_volume" "data" {
  availability_zone = aws_instance.app.availability_zone
  size              = var.data_volume_size
  type              = "gp3"
  encrypted         = true

  tags = {
    Name = "${var.name_prefix}-app-data"
  }
}

# /dev/sdf surfaces as /dev/nvme1n1 on Nitro — user-data waits for it.
resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.app.id
}
