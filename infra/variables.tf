variable "state_passphrase" {
  description = "Passphrase for OpenTofu state encryption (set TF_VAR_state_passphrase). At least 16 characters."
  type        = string
  sensitive   = true
}

variable "account_id" {
  description = "Cloudflare account ID (dashboard: Account home, right-hand side)."
  type        = string
}

variable "zone_ids" {
  description = "Zone ID per domain (dashboard: the domain's Overview page)."
  type        = map(string)
}

variable "production_branch" {
  description = "Git branch Cloudflare deploys as production."
  type        = string
  default     = "claude/tender-rubin-pmy942"
}

variable "hub_keys" {
  description = "Keys for the hub's own records (the operators'): sk-ed25519:… from `timda key`."
  type        = list(string)
}
