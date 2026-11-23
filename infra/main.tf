# TIMDA's hub on Cloudflare, in code. (Sections manage their own records; Section 72's
# live in the section72.net repo.) Everything here was first made by hand;
# imports.tf adopts those resources so the first apply changes nothing.

# ---- the website ---------------------------------------------------------------

resource "cloudflare_pages_project" "timda_website" {
  account_id        = var.account_id
  name              = "timda-station"
  production_branch = var.production_branch

  build_config = {
    build_command   = ""
    destination_dir = "public"
    root_dir        = ""
  }

  source = {
    type = "github"
    config = {
      owner                      = "timda-space"
      repo_name                  = "timda-website"
      production_branch          = var.production_branch
      pr_comments_enabled        = true
      # Preview builds only for staging (staging.timda.space); other branches get none.
      preview_deployment_setting = "custom"
      preview_branch_includes    = ["staging"]
    }
  }
}

resource "cloudflare_pages_domain" "staging" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.timda_website.name
  name         = "staging.timda.space"
}

# ---- zone hygiene ----------------------------------------------------------------
# DNSSEC is recommended by TIMDA-1 §9. timda.space is registered through
# Cloudflare, which publishes the DS record automatically. For a domain registered
# elsewhere, add the DS record at that registrar after enabling.

resource "cloudflare_zone_dnssec" "timda_space" {
  zone_id = var.zone_ids["timda.space"]
  status  = "active"
}

locals {
  zone_settings = {
    for pair in setproduct(keys(var.zone_ids), [
      { id = "always_use_https", value = "on" },
      { id = "min_tls_version", value = "1.2" },
    ]) : "${pair[0]}/${pair[1].id}" => { zone = pair[0], id = pair[1].id, value = pair[1].value }
  }
}

resource "cloudflare_zone_setting" "this" {
  for_each   = local.zone_settings
  zone_id    = var.zone_ids[each.value.zone]
  setting_id = each.value.id
  value      = each.value.value
}

# ---- TIMDA-1 records -------------------------------------------------------------

module "hub" {
  source  = "./modules/timda-section"
  zone_id = var.zone_ids["timda.space"]
  domain  = "timda.space"
  name    = "TIMDA"
  type    = "hub"
  status  = "open"
  concept = "Deep Thoughts Station Arrivals. Wormholes to every docked Section."
  keys    = var.hub_keys
  charter = "https://timda.space/charter"
  inbox   = "timda.space" # the Board's own mail, by Wormhole Post
}

