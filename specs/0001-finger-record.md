# TIMDA-1: The `_timda` finger records

| | |
| --- | --- |
| **Status** | Stable (1.0) |
| **Version tag** | `TIMDA1` |
| **Replaces** | — |

## 1. Purpose

A Section announces itself to the station with a few DNS TXT records under `_timda` on its own domain. Together they do what the old `finger` command did: anyone can ask a domain who it is and get a short, human-readable answer back.

**Identity in TIMDA is a domain and a public key. Nothing else.** The domain is the Section. The key is whoever runs it. Records carry no names, handles or contact details, and readers MUST NOT expect any.

The records hold **kayfabe**, the in-world identity, plus the keys. They can point to three pages: the **airlock**, where visitors arrive from the hub; the **setting**, the place's in-world lore; and the **charter**, the definitive, out-of-character rules for using the Section and how to reach whoever runs it.

Publishing the records is how a site **opts in**. Removing them is how a site **opts out**. Nothing else is required, and the hub must not list a site that doesn't have valid records (see §8).

The key words MUST, SHOULD and MAY are used as in RFC 2119.

## 2. Records

Everything lives under the underscore-prefixed name `_timda` (RFC 8552 attrleaf) on the Section's domain. Each piece has its own name, so each stays small and can be changed by itself:

| Name | Holds | How many |
| --- | --- | --- |
| `_timda.<domain>` | **The core:** name, status, type, concept, expiry, auth (§4) | Exactly one |
| `_key._timda.<domain>` | **One key per record** (§5) | One or more, up to 8 |
| `_airlock._timda.<domain>` | The airlock URL (§6) | At most one |
| `_charter._timda.<domain>` | The charter URL (§6) | At most one |
| `_setting._timda.<domain>` | The setting URL (§6) | At most one |
| `_button._timda.<domain>` | The Section's 88×31 button image (§6.1) | At most one |
| `_banner._timda.<domain>` | A 468×60 banner, with an optional caption (§6.2) | At most one |
| `_inbox._timda.<domain>` | Where the Section takes signed messages, and an optional age key ([TIMDA-3](0003-inbox.md)) | At most one |

A minimal Section is two records: the core and one key.

- The domain the records sit under is the Section's **identity**. The hub keys everything on it.
- At each name, only TXT records starting with `v=TIMDA` count. Others MUST be ignored.

### 2.1 Keeping the pieces consistent

The records are separate, so DNS can't update them all at once. TIMDA is designed so that a mismatch is always harmless:

1. **The core is the anchor.** Key and link records count only if a valid core record exists. Without a core, they're ignored, and the lookup stops there.
2. **A Section needs a core and at least one usable key.** A core without a key isn't valid, so it's never listed. Keys without a core are ignored.
3. **Every record carries the version tag.** A record with a version the reader doesn't know is ignored with a warning, never misread.
4. **Ambiguity is rejected.** Two core records make the Section invalid. Two records at one link name make that link ignored, and two inbox records close the inbox.
5. **Mismatches reject; they never accept.** While records change, a reader may briefly see an old and a new piece together. The worst outcome is a Section not being listed, or a signature not verifying, until DNS settles. Since nothing is pinned (§9.1), the next check sees the settled state.

Publishers SHOULD give all of a Section's `_timda` records **the same TTL**, so caches expire them together. They SHOULD also generate the full set from one place, such as the reference tool's `timda plan`, rather than editing pieces by hand.

## 3. Syntax

Every record, core or not, is a list of `tag=value` pairs separated by semicolons, in the same family as DKIM and DMARC records.

```abnf
record      = version *( *WSP ";" *WSP tag ) *WSP [ ";" *WSP ]
version     = "v" *WSP "=" *WSP "TIMDA1"
tag         = tag-name *WSP "=" *WSP tag-value
tag-name    = LCALPHA *( LCALPHA / DIGIT / "-" )
tag-value   = [ vchar *( vchar / SP ) ]           ; trailing whitespace is trimmed
vchar       = %x21-24 / %x26-3A / %x3C-7E / pct-encoded
pct-encoded = "%" HEXDIG HEXDIG
LCALPHA     = %x61-7A                              ; a-z
```

Rules:

1. **`v=TIMDA1` comes first.** A record that starts with `v=TIMDA` followed by anything else (for example `TIMDA2`) uses a version this reader doesn't know. For the core, the Section is **unsupported**, not invalid. For any other record, that record is ignored with a warning.
2. **Tag names are lowercase** and case-sensitive.
3. **Each tag may appear only once** per record. A duplicate makes that record invalid.
4. **Unknown tags MUST be ignored** so the format can grow without breaking older readers.
5. **Values are printable ASCII.** A literal `;` or `%`, and any non-ASCII character, MUST be percent-encoded as UTF-8 bytes (for example `;` → `%3B`, `é` → `%C3%A9`). After decoding, the bytes MUST be valid UTF-8. Plain spaces inside a value are allowed.
6. **Size.** DNS splits TXT data into character-strings of at most 255 bytes, and readers MUST join all the strings of one record with no separator. With one piece per record, every record fits in a single string.

## 4. The core record: `_timda.<domain>`

| Tag | Required | Value | Meaning |
| --- | --- | --- | --- |
| `v` | yes | `TIMDA1` | Version. |
| `name` | yes | text, ≤ 48 chars | The in-world designation of the **place**, e.g. `Section 72`. Never a person. |
| `status` | yes | `open` \| `closed` \| `pending` | `open`: listed, and the hub may send visitors here (*next*, *random*). `closed`: the place exists in the setting, and the hub lists it as dark but doesn't route visitors to it. `pending`: being set up. The records are fully valid (keys, signatures, `finger`). The hub lists it greyed out, with no link to it, and doesn't route visitors to it. A pending Section may ask to dock early. |
| `type` | no | `section` \| `place` \| `hub` | Defaults to `section`. `place` is for named locations that aren't numbered Sections (Anomaly 14, Regus 12). `hub` is only for the hub's own records. |
| `concept` | no | text, ≤ 120 chars | One line of in-world description: the finger "plan". |
| `expires` | no | `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SSZ` | After this moment (UTC; a date alone means 00:00 UTC on that day), the Section is **expired**: treated exactly as if its records were gone. For pop-up places. It can only take a Section off the list, never keep one on it. |
| `auth` | no | token list | Comma-separated auth methods the Section accepts from visitors. Defined tokens: `passkey`, `pubkey`, `none`. Unknown tokens MUST be ignored. |

Lengths are counted in Unicode code points after decoding. Breaking a required rule (missing or empty required tag, unknown `status` or `type`, a value too long, an unparseable `expires`) makes the core invalid.

`key`, `airlock`, `charter` and `setting` don't belong in the core. If a reader finds them there, it ignores them with a warning that names the record they belong in.

There MUST be exactly one TIMDA core record at `_timda.<domain>`. If a reader finds more than one, the Section is invalid (the same rule SPF uses).

## 5. Key records: `_key._timda.<domain>`

Each record holds **one** key:

```
v=TIMDA1; key=ed25519:gRfC33kq8uaLHoEvSy5bcmJSP8M64BM8nn7g2atWtkY=
```

- **Two algorithms are defined.** For both, the key data is the 32-byte raw Ed25519 public key in standard, padded base64 (RFC 4648 §4), which is always 44 characters. It MUST be canonical: decoding it and encoding it again gives the same text.

  | `alg` | Key | OpenSSH equivalent |
  | --- | --- | --- |
  | `ed25519` | An ordinary Ed25519 key | `ssh-ed25519` |
  | `sk-ed25519` | A hardware-backed (FIDO) Ed25519 key, such as one on a YubiKey. The FIDO application is always `ssh:`, OpenSSH's default. | `sk-ssh-ed25519@openssh.com` |

  Either converts directly into an OpenSSH public key, so Sections sign with `ssh-keygen` ([TIMDA-2](0002-signed-statements.md)).
- **Any number from 1 to 8.** Extra keys are for rotation, backup hardware keys, or several operators. Every key listed is equally valid. Readers MUST use at most the first 8 they find, and SHOULD warn about the rest.
- **A bad key record is skipped** with a warning: a malformed key, an unknown `alg`, or an unknown version. The others still count. If no usable key remains, the Section is invalid.
- **Duplicates** (the same key twice) count once.

## 6. Link records: `_airlock`, `_charter`, `_setting`, `_button`, `_banner`

Each holds one URL:

```
v=TIMDA1; url=https://section72.net/airlock
```

| Name | Page | Rules |
| --- | --- | --- |
| `_airlock._timda.<domain>` | Where visitors arrive: the hub's wormholes go here. A newcomer should find, plainly, what's really here and how to use it. | `https:`, on the Section's own domain or a subdomain. **Default:** `https://<domain>/`. |
| `_charter._timda.<domain>` | The definitive rules, out of character: conditions of use, what's logged or kept, moderation, and how to reach the operator (a signed message to the Section's key, an alias, whatever they choose; no names needed). **Where in-world text and the charter disagree, the charter wins.** | `https:`, on the Section's own domain or a subdomain, so the rules come from the operator. |
| `_setting._timda.<domain>` | The place's setting: what it is in-world (station, anomaly, ship…), its lore and history, the way a campaign setting describes a world. | `https:`, hosted anywhere (a wiki is fine). |

A link that breaks its rules, or a name with more than one record, is ignored with a warning. The rest of the Section stays valid. Without a usable airlock, the default applies.

### 6.1 The button: `_button._timda.<domain>`

A Section can name its own 88×31 button, the small image other sites link to it with:

```
v=TIMDA1; url=https://section72.net/88x31.png
```

- **The URL** follows the same rules as the airlock: `https:`, on the Section's own domain or a subdomain.
- **The image** MUST be a PNG or GIF (animated GIFs are fine), exactly 88×31 pixels, or 176×62 for sharp screens, and at most 16 KiB. Nothing else counts: no SVG, no JPEG, no other sizes.
- **Hubs never hotlink it.** A hub that shows buttons fetches the image itself (no redirects), checks its signature and dimensions, and serves its own copy, so visitors' browsers don't contact a Section until they choose to go there. A button that fails the checks is simply not shown.
- **It's re-checked with the records** (§8.2): change the image or the record and the hub picks it up at its next check. Remove the record and the button goes.

### 6.2 The banner: `_banner._timda.<domain>`

A Section can opt into the hub's showcase (the reference hub rotates banners in its Observation Lounge) by publishing a banner, with an optional caption:

```
v=TIMDA1; url=https://section72.net/468x60.png; caption=The 90s, in the future.
```

- **The URL and the image** follow the button's rules (§6.1), except the size: a PNG or GIF of exactly 468×60, or 936×120 for sharp screens, at most 64 KiB. Hubs fetch, check and serve it themselves; they never hotlink it.
- **`caption=`** is optional: up to 140 characters, percent-encoded like any value (§3). It's untrusted text, shown escaped. Only the banner record takes a caption; on any other link record it's ignored with a warning.
- **Only open Sections are shown.** Removing the record takes the Section out of the showcase at the next check.

## 7. Examples

By convention, the pages are paths on the Section's own domain: `https://<domain>/airlock`, `/charter` and `/setting`, and the button is `/88x31.png`. Any URL that follows the rules in §6 works, though.

The keys below are real Ed25519 public keys whose private halves were thrown away. They're for illustration only.

Section 72, with every piece:

```zone
_timda.section72.net.          300 IN TXT "v=TIMDA1; name=Section 72; status=open; concept=TBD"
_key._timda.section72.net.     300 IN TXT "v=TIMDA1; key=ed25519:gRfC33kq8uaLHoEvSy5bcmJSP8M64BM8nn7g2atWtkY="
_airlock._timda.section72.net. 300 IN TXT "v=TIMDA1; url=https://section72.net/airlock"
_charter._timda.section72.net. 300 IN TXT "v=TIMDA1; url=https://section72.net/charter"
_setting._timda.section72.net. 300 IN TXT "v=TIMDA1; url=https://section72.net/setting"
_button._timda.section72.net.  300 IN TXT "v=TIMDA1; url=https://section72.net/88x31.png"
```

Section 76, the minimum:

```zone
_timda.section76.net.      300 IN TXT "v=TIMDA1; name=Section 76; status=open; concept=TBD"
_key._timda.section76.net. 300 IN TXT "v=TIMDA1; key=ed25519:n1/bQ0EAOa6B5AGVr9JAphsojj5oS8egd5VOvPTBjNo="
```

A pop-up place that's dark until it opens, and disappears after the event:

```zone
_timda.anomaly14.example.      300 IN TXT "v=TIMDA1; name=Anomaly 14; type=place; status=closed; concept=Do not approach.; expires=2027-01-04"
_key._timda.anomaly14.example. 300 IN TXT "v=TIMDA1; key=ed25519:i63v5rK3AoIAcCce0CvWIwS9sEgMStN2BdkzjTVn96w="
```

The hub, with two operators' hardware keys:

```zone
_timda.timda.space.          300 IN TXT "v=TIMDA1; name=TIMDA Central Concourse; type=hub; status=open"
_key._timda.timda.space.     300 IN TXT "v=TIMDA1; key=sk-ed25519:TeirogOLiZPkAEZZzZjieeNfCQNCqkT764/a2VZ83PA="
_key._timda.timda.space.     300 IN TXT "v=TIMDA1; key=sk-ed25519:CzvLzCJ8enh9Y3gnGjCNdguztAxT+MgDsjVDNkXxEwg="
_charter._timda.timda.space. 300 IN TXT "v=TIMDA1; url=https://timda.space/charter"
```

The `concept` values for Sections 72 and 76 are placeholders.

Looked up with the reference tool, Section 72 reads like this:

```
$ node tools/timda.mjs finger section72.net
[section72.net]
Designation: Section 72                   Type: section
Status: open
Key: ed25519:gRfC33kq8uaLHoEvSy5bcmJSP8M64BM8nn7g2atWtkY=
SSH: ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIEXwt95KvLmix6BL0suW3JiUj/DOuATPJ5+4NmrVrZG
Airlock: https://section72.net/airlock
Charter: https://section72.net/charter
Setting: https://section72.net/setting
Plan:
  TBD

Checks:
  GOOD  core record valid (status: open)
  GOOD  1 key: ed25519
  GOOD  airlock, charter, setting: valid links
  WARN  DNSSEC not validated (optional, recommended)
```

Each check is **GOOD**, **WARN** (worth fixing, but the Section is valid) or **CRIT** (the Section isn't valid, or isn't listed). On a terminal they're green, amber and red. The tool exits with 0 unless there's a CRIT.

## 8. Hub behaviour

The hub uses these records to decide what it lists. To respect opt-in:

1. **Two things to get in.** The hub lists a domain only if it's in the hub's registry **and** the domain currently has a valid, unexpired Section (§2.1). Getting into the registry takes a signed dock request ([TIMDA-2](0002-signed-statements.md)).
   - **Hubs decide what they list.** A hub MAY review new Sections before listing them (showing nothing of theirs until approved) and MAY delist a Section at its discretion, refusing its dock requests until it reinstates it. The reference hub reviews every new Section; its operator acts through signed Board resolutions (TIMDA-2 §5).
2. **The records are the off switch.** The hub MUST re-check a Section's records before listing it or routing to it, reusing a result for no longer than the records' TTL and never more than a day. When a Section disappears, turns invalid or expires, the hub drops it from listings and routing at the next check. Nobody has to ask anyone. If the records' TTLs differ, the shortest one counts. (The reference hub re-checks on use and reuses each result for the shortest TTL it read, at least a minute and at most an hour, so with the recommended 300-second TTL a change shows up within five minutes.)
3. **Look up the core first.** If there's no valid core, stop; the other names aren't needed.
4. **Only `status=open` is routed.** *next* and *random* MUST skip `closed` and `pending` Sections. Listings show `closed` ones as dark and `pending` ones greyed out, without links to either.
5. **The keys speak for the Section.** Anything the hub accepts *from* a Section (a registry change, a message, a vote if there ever are votes) SHOULD be signed by a key currently in that Section's key records. The hub keeps no accounts, names or emails.
6. **Treat record content as untrusted.** Values are attacker-controlled text. The hub MUST escape them when rendering. It MUST NOT auto-fetch or embed the airlock, charter or setting pages into its own pages; it shows them as plain links. The only things it may fetch are the button and the banner, under the rules in §6.1 and §6.2. Wherever it lists a Section, the hub SHOULD show the charter link if there is one.
7. **Wormholes go to the airlock.** When the hub sends a visitor to a Section (a listing, *next*, *random*), it links to the airlock, or to `https://<domain>/` if there isn't one. Because the airlock must stay on the Section's own domain, a Section can't use the hub's name to send visitors somewhere else.
8. **DNSSEC.** Sections SHOULD sign their zones. The hub SHOULD validate DNSSEC where its resolver supports it (Cloudflare's DoH resolver does) and MAY show signed Sections differently.

## 9. Security considerations

- **Control of DNS is authority over the Section.** Whoever can change the records can replace the keys. That's by design: the domain *is* the Section. Protect the registrar and DNS accounts accordingly, and use DNSSEC.
- **The records say nothing about who anyone is in real life,** and they aren't meant to. A key proves continuity ("the same operator as last time"), not identity.
- **Key reuse links Sections.** Using one key for several domains publicly shows they share an operator. Use separate keys if you don't want that.
- **Spoofing.** Without DNSSEC, an on-path attacker can forge records, keys included. That only fools whoever is doing the lookup, and in practice the hub resolves over DoH.
- **Wildcards.** A wildcard TXT record (`*.example.com`) also answers for `_timda.example.com` if there's no explicit record. It only counts if it starts with `v=TIMDA`, which is very unlikely by accident, but operators using wildcards should know.
- **Privacy.** TXT records are public and get archived by passive-DNS services. Don't put anything in one you wouldn't want kept forever.

### 9.1 No sticky state

TIMDA must never leave someone locked out of their own Section. So:

- **Nothing pins keys.** Verifiers and hubs MUST read keys from DNS each time and MUST NOT remember them beyond the records' TTL. A removed key stops working, and an added one starts working, as soon as DNS says so.
- **No key continuity is required.** A new key never needs an old key's approval. Control of the domain's DNS is the only authority, so losing a private key costs nothing but a record update.
- **Leaving and returning are both just DNS.** Removing the records, or letting `expires` pass, delists the Section at the next check. Publishing again makes it eligible again. Nothing is held against the domain in between.
- **The one exception is a hub's own editorial choice** (§8.1): a hub may delist a domain and decline to list it again. That is about what one hub shows, never about the domain's identity: it doesn't pin or revoke keys, and it doesn't affect any other hub.
- **Keys don't expire.** There's deliberately no per-key expiry: forgetting to renew one would lock an operator out of their own Section.
- **Short TTLs.** Publishers SHOULD use a TTL of an hour or less (300 seconds is a good default), the same on every `_timda` record.

Things that could create sticky state (HSTS with `includeSubDomains` or preload on the hub's domain, key pinning, long-lived caches of records) are out of bounds for anything that affects Sections.

## 10. Versioning

**TIMDA-1 is stable.** Records written to it today keep working: it will only grow in ways that existing readers and records can ignore, and anything that would break a published record gets a new version tag instead.

Adding a new optional tag, a new link record, or a new key algorithm (as `sk-ed25519` was) doesn't need a new version, because readers ignore what they don't know. Changing the meaning of an existing tag or record, adding a required one, or changing the syntax needs `v=TIMDA2` and a new spec number.
