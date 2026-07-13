# Terraform — production infrastructure

Provisions the AWS side of [docs/deployment.md]:
CloudFront + S3 in front of a single EC2 node (docker compose: backend,
scheduler, redis), the audit SQS→Lambda→S3 pipeline, Secrets Manager, SES,
and CloudWatch/SNS monitoring. Postgres stays on hosted Supabase — not
managed here.

## Layout

The root is the prod composition; every resource lives in a local module:

| Module           | Owns                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `network`        | /24 VPC, public subnet, IGW, API security group (CloudFront-prefix-list-only ingress, no SSH — SSM)  |
| `secrets`        | Secrets Manager: app runtime env, X-Origin-Verify header secret                                      |
| `email`          | SES domain identity + DKIM for obsidian-secured.com, SMTP credentials                                |
| `compute`        | EC2 (t4g.small), EIP, EBS data volume, instance role, user-data bootstrap                            |
| `audit_pipeline` | audit-export.fifo + DLQ, archiver Lambda, archive S3 bucket                                          |
| `frontend`       | Assets S3 bucket, ACM cert, CloudFront distribution (S3 default + `/api/*` origin), Route 53 aliases |
| `monitoring`     | SNS alerts topic, log groups, status-check / container-health / DLQ / Lambda alarms                  |

Status: all modules implemented. `terraform plan` shows the full stack
(~60 resources); see the bootstrap list below for the manual one-time steps.

## One-time bootstrap (before first real apply)

1. **State bucket** (can't manage its own backend — chicken and egg):

    ```bash
    aws s3api create-bucket --bucket obsidian-terraform-state --region us-east-1
    aws s3api put-bucket-versioning --bucket obsidian-terraform-state \
      --versioning-configuration Status=Enabled
    aws s3api put-public-access-block --bucket obsidian-terraform-state \
      --public-access-block-configuration \
      BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
    ```

    Then uncomment the `backend "s3"` block in `terraform.tf` and run
    `terraform init -migrate-state`.

2. **Domain**: obsidian-secured.com registration must be complete (Route 53
   creates the hosted zone automatically) before the `email`/`frontend`
   modules can plan.

3. **SES production access**: request it in the SES console — sandboxed
   accounts only send to verified addresses.

4. **Secret values**: after `secrets` is applied, set the app secret's value
   once via CLI/console (Terraform ignores value changes by design — values
   never touch state via config).

5. **SNS confirmation**: click the link in the subscription email or alarms
   go nowhere.

## Day-to-day

```bash
terraform fmt -recursive
terraform validate
terraform plan
terraform apply
```

Frontend deploys are not Terraform: `npm run build`, sync `dist/` to the
assets bucket, invalidate the distribution. Backend deploys happen on the box
(`git pull && docker compose -f docker-compose.prod.yaml up -d --build`).
