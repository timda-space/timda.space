# The station

TIMDA is a retro-futurist space station: a digital Epcot and a shared social experiment, spread across the web. It is one setting that many people inhabit. Each of them runs their own piece of it, on their own terms.

## Principle: purely opt-in

Nothing about TIMDA is mandatory:

- **Joining** is opt-in. A site becomes part of TIMDA only when whoever runs it publishes records saying so (see [TIMDA-1](../specs/0001-finger-record.md)). Deleting them takes the site out.
- **Linking** is opt-in. Being listed doesn't oblige a Section to link back, carry a banner, or join the ring.
- **Integration depth** is opt-in. A Section can be a single link on its own domain, or it can live inside TIMDA proper.
- **Kayfabe** is opt-in. Visitors and operators can play along with the setting or ignore it completely.

Any design that pulls someone in without their choice is out of bounds.

## Layout

### The hub: `timda.space`

The main concourse. It lists Sections, routes visitors between them, and hosts the shared parts of the setting. It works much like an old webring (*next*, *random*), but every jump passes through the hub.

### Sections

A Section is a part of the station run independently, usually on its own domain. The domain is the Section, and its public key stands for whoever runs it.

| Section | Domain |
| --- | --- |
| Section 72 | `section72.net` |
| Section 76 | `section76.net` |

A Section can:

- **Stay on its own domain.** The hub links out to it.
- **Live on TIMDA proper** (for example `section72.timda.space`) for deeper integration.

### Other places

Not everything has to be a numbered Section. Other named places are allowed, such as **Anomaly 14** or **Regus 12**. TIMDA-1 records these as `type=place`.

### Getting around: wormholes and transwarp

In-world, visitors travel from the hub to a Section through a **wormhole** or **transwarp link**. In practice it's a hyperlink, or a redirect from a hub route such as `/random`. For what each part of the station stands for, see [station anatomy](anatomy.md).

## Kayfabe vs. shoot

Wrestling terms, borrowed:

- **The work (kayfabe)** is the in-world identity: what the Section is called in the setting, its concept, and how residents refer to it. It goes in the Section's core `_timda` record.
- **The shoot** is what the Section actually offers in the real world and real instructions for using it.

A Section's records can link three pages, each published at its own name under `_timda`:

| Record | Page | Work or shoot |
| --- | --- | --- |
| `_airlock._timda` | Where visitors arrive from the hub. Should say plainly what's really here. | Either |
| `_setting._timda` | The place's in-world lore, the way a campaign setting describes a world. | Work |
| `_charter._timda` | The definitive rules for using the Section, and how to reach whoever runs it. Where in-world text and the charter disagree, the charter wins. | Shoot |

Keeping the two apart lets the setting stay in character while everyone can still find out what's really there.

## Discovery: the finger records

Each Section publishes a few DNS TXT records under `_timda.<its domain>`: a core record, one record per key, and optional links. Together they work like the old `finger` command: ask a domain who it is, and it replies with its in-world designation, its public keys, whether it's open, and its concept. The format is defined in [TIMDA-1](../specs/0001-finger-record.md).

## Identity and auth

- **Identity is a domain and a public key. Nothing else.** No names, no handles, no emails, no accounts. A Section is its domain; whoever runs it holds a key in its key records.
- **People talk using public-key encryption.** "Here's my key" is how you introduce yourself, and a signature from a Section's key is how the Section speaks.
- **Each Section is its own issuer** and picks its own auth: passkeys, certificate or key-based ("send me your public key"), or none at all. There's no central account system. A Section can list the methods it accepts with `auth=` in its core record.
- Section 72 will probably accept passkeys.

## Hosting (for reference)

The hub targets the Cloudflare Pages free plan: static pages, plus Pages Functions with KV for the dynamic parts: the registry, checks, nonces and mail; listings, routing, docking, the Board and the Wormhole Post. Section TXT records live in whatever DNS each Section uses; the hub's own zone is on Cloudflare. Build details belong in [`timda-website`](https://github.com/timda-space/timda-website).
