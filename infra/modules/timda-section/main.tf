# Publishes one Section's TIMDA-1 records: the core, one record per key, and
# optional airlock / charter / setting / button / banner links, and an inbox (TIMDA-3). Every record gets the same TTL.

terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}

locals {
  core = join("; ", compact([
    "v=TIMDA1",
    "name=${var.name}",
    "status=${var.status}",
    var.type != "section" ? "type=${var.type}" : "",
    var.concept != null ? "concept=${var.concept}" : "",
    var.expires != null ? "expires=${var.expires}" : "",
    length(var.auth) > 0 ? "auth=${join(",", var.auth)}" : "",
  ]))

  links = { for part, url in {
    airlock = var.airlock
    charter = var.charter
    setting = var.setting
    button  = var.button
    banner  = var.banner
  } : part => url if url != null }

  # everything but setting must stay on this domain (TIMDA-1 §6)
  same_domain_ok = alltrue([
    for part, url in local.links :
    part == "setting" || can(regex("^https://([a-z0-9-]+\\.)*${replace(var.domain, ".", "\\.")}(/|$)", url))
  ])
}

resource "cloudflare_dns_record" "core" {
  zone_id = var.zone_id
  name    = "_timda.${var.domain}"
  type    = "TXT"
  content = "\"${local.core}\""
  ttl     = var.ttl
  comment = "TIMDA-1 core record (managed by OpenTofu)"

  lifecycle {
    precondition {
      condition     = local.same_domain_ok
      error_message = "airlock, charter, button and banner must be https URLs on ${var.domain} or a subdomain of it."
    }
    precondition {
      condition     = alltrue([for u in values(local.links) : startswith(u, "https://")])
      error_message = "airlock, charter, setting and button must be https URLs."
    }
  }
}

resource "cloudflare_dns_record" "key" {
  # Keyed by the key itself, so adding or removing one key never touches the others.
  for_each = toset(var.keys)

  zone_id = var.zone_id
  name    = "_key._timda.${var.domain}"
  type    = "TXT"
  content = "\"v=TIMDA1; key=${each.value}\""
  ttl     = var.ttl
  comment = "TIMDA-1 key record (managed by OpenTofu)"
}

locals {
  inbox = var.inbox == null ? null : "v=TIMDA1; hub=${var.inbox}${var.inbox_age == null ? "" : "; age=${var.inbox_age}"}"
}

resource "cloudflare_dns_record" "inbox" {
  count = var.inbox == null ? 0 : 1

  zone_id = var.zone_id
  name    = "_inbox._timda.${var.domain}"
  type    = "TXT"
  content = "\"${local.inbox}\""
  ttl     = var.ttl
  comment = "TIMDA-3 inbox record (managed by OpenTofu)"
}

resource "cloudflare_dns_record" "link" {
  for_each = local.links

  zone_id = var.zone_id
  name    = "_${each.key}._timda.${var.domain}"
  type    = "TXT"
  content = each.key == "banner" && var.banner_caption != null ? "\"v=TIMDA1; url=${each.value}; caption=${var.banner_caption}\"" : "\"v=TIMDA1; url=${each.value}\""
  ttl     = var.ttl
  comment = "TIMDA-1 ${each.key} record (managed by OpenTofu)"
}
