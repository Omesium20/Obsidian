variable "name_prefix" {
  description = "Prefix for resource names (project-environment)"
  type        = string
}

variable "lambda_source_dir" {
  description = "Path to lambda/audit-archiver in this repo (zipped at plan time)"
  type        = string
}
