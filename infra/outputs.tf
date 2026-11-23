# Check what OpenTofu will publish with the reference tool:
#   tofu output -raw hub_zone > hub.zone && node ../tools/timda.mjs check hub.zone timda.space
output "hub_zone" {
  value = module.hub.zone
}
