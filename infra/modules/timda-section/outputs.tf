# The same records in zone-file form, so they can be checked with the reference tool:
#   tofu output -raw <output name> > section.zone
#   node tools/timda.mjs check section.zone <domain>        (timda.mjs is in the timda.space repo)
output "zone" {
  description = "Every record this module publishes, in zone-file format."
  value = join("\n", concat(
    ["_timda.${var.domain}. ${var.ttl} IN TXT \"${local.core}\""],
    [for k in var.keys : "_key._timda.${var.domain}. ${var.ttl} IN TXT \"v=TIMDA1; key=${k}\""],
    [for part, url in local.links : "_${part}._timda.${var.domain}. ${var.ttl} IN TXT \"v=TIMDA1; url=${url}\""],
    local.inbox == null ? [] : ["_inbox._timda.${var.domain}. ${var.ttl} IN TXT \"${local.inbox}\""],
  ))
}
