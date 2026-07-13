provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ── Leaf modules (no dependencies) ──────────────────────────────────────────

module "network" {
  source = "./modules/network"

  name_prefix = local.name_prefix
  vpc_cidr    = var.vpc_cidr
  api_port    = var.api_port
}

module "secrets" {
  source = "./modules/secrets"

  name_prefix = local.name_prefix
}

module "email" {
  source = "./modules/email"

  name_prefix = local.name_prefix
  domain_name = var.domain_name
}

module "cicd" {
  source = "./modules/cicd"

  name_prefix = local.name_prefix
  github_repo = var.github_repo
}

module "audit_pipeline" {
  source = "./modules/audit_pipeline"

  name_prefix       = local.name_prefix
  lambda_source_dir = "${path.root}/../lambda/audit-archiver"
}

# ── Compute (needs network, secrets, audit queue) ───────────────────────────

module "compute" {
  source = "./modules/compute"

  name_prefix              = local.name_prefix
  instance_type            = var.instance_type
  repo_url                 = var.repo_url
  subnet_id                = module.network.public_subnet_id
  security_group_id        = module.network.api_security_group_id
  app_secret_arn           = module.secrets.app_secret_arn
  origin_verify_secret_arn = module.secrets.origin_verify_secret_arn
  audit_queue_arn          = module.audit_pipeline.queue_arn
  audit_queue_url          = module.audit_pipeline.queue_url
}

# ── Frontend (needs the EC2 origin + origin-verify header value) ────────────

module "frontend" {
  source = "./modules/frontend"

  name_prefix         = local.name_prefix
  domain_name         = var.domain_name
  api_origin_domain   = module.compute.public_dns
  api_origin_port     = var.api_port
  origin_verify_value = module.secrets.origin_verify_value
}

# ── Monitoring (observes everything above) ──────────────────────────────────

module "monitoring" {
  source = "./modules/monitoring"

  name_prefix        = local.name_prefix
  alert_email        = var.alert_email
  instance_id        = module.compute.instance_id
  container_services = ["backend", "scheduler", "redis"]
  audit_dlq_name     = module.audit_pipeline.dlq_name
  lambda_name        = module.audit_pipeline.lambda_name
}
