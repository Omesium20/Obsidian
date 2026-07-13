variable "name_prefix" {
  description = "Prefix for resource names (project-environment)"
  type        = string
}

variable "github_repo" {
  description = "GitHub org/repo whose workflows may assume the roles (e.g. Omesium20/Obsidian)"
  type        = string
}
