# CI/CD — GitHub Actions

Three workflows in `.github/workflows/`. One rule underneath them all:
**PRs can only read AWS; only main can write** — enforced by AWS IAM trust
conditions, not by workflow configuration.

## Workflows

| File | Trigger | Does |
|---|---|---|
| `test.yml` | called by the other two | The single definition of "passing": `npm ci`, lint, Supabase local stack, `npm test`. |
| `ci.yml` | `pull_request` | Tests → build artifacts (`frontend-dist`, `backend-dist`) → read-only `terraform plan` posted as a PR comment + `terraform-plan` artifact. |
| `deploy.yml` | `push` to `main` (merge **or** direct commit) | Tests → `terraform plan -out` + `apply` (same job, fresh plan) → SPA sync to S3 + CloudFront invalidation → backend deploy over SSM (`git pull && compose up -d --build`). |

Notes:

- **The PR plan is informational; main re-plans before applying.** A saved
  plan goes stale the moment state moves; the fresh plan-and-apply in one job
  is the correctness guarantee. Review the plan on the PR — `to destroy`
  and `forces replacement` are what you're looking for.
- Only the plan **text** is uploaded/commented (sensitive values masked). The
  binary plan file embeds state — it never leaves the job.
- `deploy.yml` runs under a `prod-deploy` concurrency group: a second push
  queues rather than racing the first apply (the S3 state lockfile is the
  backstop).
- The SSM step is the documented manual deploy
  ([deployment.md](deployment.md)) plus a fresh `obsidian-render-env`, so
  rotated secrets get picked up on the next deploy.

## Auth: OIDC roles (terraform `modules/cicd`)

No AWS keys exist in GitHub. Each job presents a GitHub-signed identity token
to AWS STS and gets ~1-hour credentials for one of:

| Role | Trust | Permissions |
|---|---|---|
| `obsidian-prod-gha-plan` | any branch/PR of the repo | `ReadOnlyAccess` (cannot read secret *values*); plan runs `-lock=false` |
| `obsidian-prod-gha-deploy` | **only** `refs/heads/main` | `PowerUserAccess` + IAM scoped to `obsidian-prod-*` principals |

A feature-branch workflow — even a malicious one — cannot assume the deploy
role: AWS rejects the token's branch claim.

## Repo secrets (Settings → Secrets and variables → Actions)

| Secret | Value |
|---|---|
| `AWS_PLAN_ROLE_ARN` | `terraform output -raw gha_plan_role_arn` |
| `AWS_DEPLOY_ROLE_ARN` | `terraform output -raw gha_deploy_role_arn` |
| `PLAID_CLIENT_ID` | Plaid dashboard (tests, sandbox) |
| `PLAID_SANDBOX_SECRET` | Plaid dashboard (tests, sandbox) |

The other `.env.test` values (test JWT secrets, test encryption key) are
hardcoded in `test.yml` on purpose: the CI database is created and dropped
within the job, so they protect nothing.

## First-time order (chicken and egg)

The OIDC roles are Terraform resources, so the first apply must come from a
workstation: `terraform init && terraform apply` locally → set the four repo
secrets → push. From then on the pipeline owns applies.
