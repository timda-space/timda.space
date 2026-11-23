# Adopt what was created by hand in the dashboard, instead of creating duplicates.
# After the first successful apply these blocks can stay (they're no-ops) or go.

import {
  to = cloudflare_pages_project.timda_website
  id = "${var.account_id}/timda-station"
}

import {
  to = cloudflare_pages_domain.staging
  id = "${var.account_id}/timda-station/staging.timda.space"
}

import {
  for_each = local.zone_settings
  to       = cloudflare_zone_setting.this[each.key]
  id       = "${var.zone_ids[each.value.zone]}/${each.value.id}"
}

import {
  to = cloudflare_zone_dnssec.timda_space
  id = var.zone_ids["timda.space"]
}
