# AGENTS.md

Guidance for anyone (human or AI agent) working in this repo.

## What TIMDA is

TIMDA (Technocratic Incorporated Multi-node Digital Astrodrome) is a retro-futurist space-station webring hub. Sites ("Sections") opt in with DNS TXT records under `_timda`, identify only by domain + SSH public key, and sign statements with `ssh-keygen -Y sign -n timda`.

Principles. Don't break these:

- **Everything is opt-in.** Nobody is pulled into any part of it.
- **Sections never have to name a person.** Identity is domain + key.
- **No accounts.**
- **No JavaScript sent to browsers.**
- **No sticky state**, except a hub's editorial delisting.

**Sections are anonymous; the project isn't. Contribute under your own account.**

## This repo

`timda-space/timda.space`: specs, docs, infra and the reference CLI. The hub lives in `timda-space/timda-website`.

| Path | What |
| --- | --- |
| `specs/` | TIMDA-1 (`_timda` records) and TIMDA-2 (signed statements): Stable 1.0. TIMDA-3 (inboxes): Draft. |
| `concepts/`, `guides/`, `governance/` | Setting, look, docking guide, open questions |
| `infra/` | OpenTofu for the station's Cloudflare setup; `modules/timda-section` is a template Sections can copy |
| `tools/` | The `timda` CLI and the reference parser/verifier. Zero npm dependencies, Node 20+. `tools/vendor/` holds vendored code with its licence notes. |

`specs/`, `tools/timda1.mjs` and `tools/sshsig.mjs` are the originals. `timda-website` vendors copies and has a drift test, so a change here needs the matching copy there.

Licences: code MIT (`LICENSE`), docs CC BY 4.0 (`LICENSE-docs`).

## Build and test

```console
$ npm test        # node --test; 40 tests. Signing tests need ssh-keygen installed.
$ node tools/timda.mjs help
```

No install step and no dependencies. Keep it that way.

## Workflow

- Branches: `main` (production) and `staging`.
- Work goes by pull request into `staging`, then a release PR `staging` -> `main`.
- **Never merge PRs yourself.** The maintainer merges.
- **Never force-push.** Never delete `staging`.
- Keep personal details (real names, email addresses) out of files and commit messages.
- When specs or shared code change, open the matching PR in `timda-website` too.
