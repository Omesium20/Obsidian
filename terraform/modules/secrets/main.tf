# Two secrets with opposite ownership models:
#
#   app-env        — Terraform creates the container and seeds placeholder keys;
#                    the VALUES are set once out-of-band (CLI/console) and
#                    ignore_changes keeps them out of state/config forever.
#   origin-verify  — fully Terraform-owned: a generated random value shared
#                    between CloudFront (injected as the X-Origin-Verify origin
#                    header) and the box (checked on every /api/* request).

# ── App runtime secrets ──────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "app_env" {
  name        = "${var.name_prefix}/app-env"
  description = "Obsidian backend runtime secrets - values managed outside Terraform"

  # 7 days instead of the 30-day default so a destroy/recreate cycle during
  # development doesn't leave the name unavailable for a month.
  recovery_window_in_days = 7
}

# Seed version: documents every key .env.docker.prod needs so filling it in the
# console is fill-in-the-blanks. Only secrets belong here — non-secret env
# (REDIS_URL, WORKER_ROLE, SQS_AUDIT_QUEUE_URL, PORT) is set by compose and
# the compute user-data.
resource "aws_secretsmanager_secret_version" "app_env_seed" {
  secret_id = aws_secretsmanager_secret.app_env.id
  secret_string = jsonencode({
    supabase                = "CHANGEME" # full PG connection string (lowercase key — config/database.ts)
    JWT_ACCESS_SECRET       = "CHANGEME"
    JWT_REFRESH_SECRET      = "CHANGEME"
    PLAID_CLIENT_ID         = "CHANGEME"
    PLAID_PRODUCTION_SECRET = "CHANGEME"
    PLAID_ENCRYPTION_KEY    = "CHANGEME" # 32-byte hex; rotating requires re-encrypting plaid_items
    SMTP_HOST               = "email-smtp.us-east-1.amazonaws.com"
    SMTP_PORT               = "465"
    SMTP_USER               = "CHANGEME" # email module output (SES IAM access key id)
    SMTP_PASS               = "CHANGEME" # email module output (SigV4-derived SMTP password)
    EMAIL_FROM              = "CHANGEME" # e.g. no-reply@obsidian-secured.com
  })

  lifecycle {
    # Real values are set out-of-band; Terraform must never see or revert them.
    ignore_changes = [secret_string]
  }
}

# ── X-Origin-Verify header secret ────────────────────────────────────────────

resource "random_password" "origin_verify" {
  length  = 32
  special = false # header-safe alphanumeric
}

resource "aws_secretsmanager_secret" "origin_verify" {
  name        = "${var.name_prefix}/origin-verify"
  description = "Shared secret proving /api/* requests came through our CloudFront distribution"

  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "origin_verify" {
  secret_id     = aws_secretsmanager_secret.origin_verify.id
  secret_string = random_password.origin_verify.result
}
