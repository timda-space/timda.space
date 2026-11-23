# infra

The hub's Cloudflare setup as [OpenTofu](https://opentofu.org/) code: the Pages project, the staging domain, zone settings (always HTTPS, TLS 1.2+, DNSSEC), and the hub's own TIMDA-1 records (`timda.space`).

Sections manage their own records in their own repos. Section 72 does, in `section72.net/infra`, using a copy of the module here.

It lives beside the specs and tools so changes are **auditable** in one place, and so anyone running a Section can **copy it as a template**. [`modules/timda-section`](modules/timda-section) is the reusable part.

## What you need

- **OpenTofu 1.8 or newer** (for state encryption).
- **A Cloudflare API token** with only:
  - Account → Cloudflare Pages: Edit
  - Zone → DNS: Edit, Zone Settings: Edit, Zone: Read (for `timda.space` only)
- **An R2 bucket for state** (`timda-tofu-state`), and an R2 API token for it.
- **Your keys:** `node tools/timda.mjs key ~/.ssh/<key>.pub` (from the repo root) prints the value for each.

## Run it

```console
$ cd infra
$ cp backend.hcl.example backend.hcl            # fill in your account ID
$ cp terraform.tfvars.example terraform.tfvars  # fill in IDs and keys

$ export CLOUDFLARE_API_TOKEN=…                 # the API token above
$ export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=…   # the R2 token
$ export TF_VAR_state_passphrase=…              # 16+ chars; keep it in a password manager

$ tofu init -backend-config=backend.hcl
$ tofu plan
```

**The first plan should create only the `_timda` records.** Everything else already exists, and `imports.tf` adopts it. If the plan wants to *replace* or *destroy* the Pages project or the staging domain, stop: an import ID or field name doesn't match, and needs fixing before you apply.

Before applying, check the records the way readers will see them:

```console
$ tofu output -raw hub_zone > hub.zone
$ node ../tools/timda.mjs check hub.zone timda.space
```

Then `tofu apply`, and check what's live with `node ../tools/timda.mjs finger timda.space`.

## Things to know

- **Not tested against Cloudflare yet.** This was written without network access to Cloudflare or the OpenTofu registry, and only syntax-checked. Cloudflare's v5 provider renamed many resources and fields, so the first `tofu plan` is the real test. The likeliest spots for a mismatch are the `cloudflare_pages_project` `build_config` / `source` fields and the import ID formats.
- **The staging CNAME isn't managed here.** Cloudflare creates it when the custom domain is added, and it stays tied to `cloudflare_pages_domain.staging`.
- **DNSSEC** is switched on for `timda.space`, which is registered through Cloudflare, so the DS record is handled automatically.
- **Secrets never go in files:** the API token, R2 keys and state passphrase are environment variables only. `terraform.tfvars` and `backend.hcl` hold IDs and public keys, and are git-ignored anyway.
- **Losing the state passphrase means losing the state.** OpenTofu can't decrypt it without the passphrase. Nothing on Cloudflare is affected, but you'd have to re-import everything.

## Not managed here

Some of the hub's setup is done by hand in the Cloudflare dashboard, and isn't in this code:

- **KV namespaces** `timda-registry` (production) and `timda-registry-staging` (preview), and the Pages project's `REGISTRY` bindings.
- **The `timda-notify` Worker** (its code is in the timda-website repo, `workers/notify/`), its `EMAIL` binding, `FROM` and `TO`, and the Pages project's `NOTIFY` service binding.
- **Email Routing** for timda.space: `abuse@` forwarding, and the verified destination address the Worker writes to.
- **The hub's TIMDA records** (`_timda`, `_key`, `_charter`, `_inbox` under timda.space) were published by hand. Before the first apply, adopt them with `import` blocks for `module.hub.cloudflare_dns_record.*` (each needs its record ID, `<zone_id>/<record_id>`, from the dashboard or the API), or delete them and let the apply recreate them.

