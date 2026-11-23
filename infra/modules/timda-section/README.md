# Module: `timda-section`

Publishes one Section's [TIMDA-1](../../../specs/0001-finger-record.md) records in a Cloudflare zone: the core `_timda` record, one `_key._timda` record per key, and optional `_airlock`, `_charter`, `_setting`, `_button` and `_banner` links, all with one TTL.

**Copy this folder into your own infrastructure** to run a Section. That's what it's for.

```hcl
module "my_section" {
  source  = "./modules/timda-section"
  zone_id = "…"
  domain  = "example.net"
  name    = "Section 99"
  status  = "open"
  concept = "TBD"
  keys    = ["ed25519:…"]                 # from: node tools/timda.mjs key ~/.ssh/timda.pub
  airlock = "https://example.net/airlock"
  charter = "https://example.net/charter"
  setting = "https://example.net/setting"
}
```

It enforces the same rules as `timda plan`: 1–8 keys in the right format, links over `https:`, airlock and charter on your own domain, one TTL of an hour or less. `name` and `concept` must be plain ASCII without `;` or `%`. For anything fancier, generate the records with `timda plan`, which percent-encodes for you.

Rotating a key is adding one to `keys`, applying, waiting one TTL, then removing the old one. Each key is its own resource, so the others are never touched.
