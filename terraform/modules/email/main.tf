# SES as the prod SMTP provider for Nodemailer (docs/email.md). DNS lives in
# the Route 53 hosted zone created with the domain registration, so identity
# verification is fully automated here.
#
# One thing Terraform cannot do: request SES *production access* (new accounts
# are sandboxed — they can only send TO verified addresses). One-time console
# request; see docs/terraform.md.

data "aws_region" "current" {}

data "aws_route53_zone" "main" {
  name         = var.domain_name
  private_zone = false
}

# ── Domain identity + verification ───────────────────────────────────────────

resource "aws_ses_domain_identity" "main" {
  domain = var.domain_name
}

resource "aws_route53_record" "ses_verification" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "_amazonses.${var.domain_name}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.main.verification_token]

  # The identity was first created via the console, which may have published
  # this record already; the value is identical, so overwriting is safe.
  allow_overwrite = true
}

# Blocks until SES sees the TXT record — downstream resources can rely on a
# verified identity.
resource "aws_ses_domain_identity_verification" "main" {
  domain     = aws_ses_domain_identity.main.domain
  depends_on = [aws_route53_record.ses_verification]
}

# ── DKIM ─────────────────────────────────────────────────────────────────────

resource "aws_ses_domain_dkim" "main" {
  domain = aws_ses_domain_identity.main.domain
}

resource "aws_route53_record" "dkim" {
  count = 3

  zone_id = data.aws_route53_zone.main.zone_id
  name    = "${aws_ses_domain_dkim.main.dkim_tokens[count.index]}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.main.dkim_tokens[count.index]}.dkim.amazonses.com"]

  # Console "Easy DKIM" may have auto-published these CNAMEs; same tokens,
  # same values — safe to overwrite.
  allow_overwrite = true
}

# ── Custom MAIL FROM + SPF + DMARC (deliverability) ──────────────────────────

resource "aws_ses_domain_mail_from" "main" {
  domain           = aws_ses_domain_identity.main.domain
  mail_from_domain = "mail.${var.domain_name}"
}

resource "aws_route53_record" "mail_from_mx" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = aws_ses_domain_mail_from.main.mail_from_domain
  type    = "MX"
  ttl     = 600
  records = ["10 feedback-smtp.${data.aws_region.current.region}.amazonses.com"]
}

resource "aws_route53_record" "mail_from_spf" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = aws_ses_domain_mail_from.main.mail_from_domain
  type    = "TXT"
  ttl     = 600
  records = ["v=spf1 include:amazonses.com ~all"]
}

# p=none: monitor-only. Tighten to quarantine/reject once sending is proven.
resource "aws_route53_record" "dmarc" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  ttl     = 600
  records = ["v=DMARC1; p=none;"]
}

# ── SMTP credentials for Nodemailer ──────────────────────────────────────────
# SES SMTP auth = an IAM user's access key; the SMTP password is a SigV4
# derivation the provider computes (ses_smtp_password_v4). The values go into
# the app secret as SMTP_USER / SMTP_PASS (never into git or tfvars).

resource "aws_iam_user" "smtp" {
  name = "${var.name_prefix}-ses-smtp"
}

resource "aws_iam_user_policy" "smtp" {
  name = "send-via-ses"
  user = aws_iam_user.smtp.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "SendFromOurDomainOnly"
      Effect   = "Allow"
      Action   = "ses:SendRawEmail"
      Resource = aws_ses_domain_identity.main.arn
    }]
  })
}

resource "aws_iam_access_key" "smtp" {
  user = aws_iam_user.smtp.name
}
