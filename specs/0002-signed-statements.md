# TIMDA-2: Signed statements

| | |
| --- | --- |
| **Status** | Stable (1.0) |
| **Depends on** | [TIMDA-1](0001-finger-record.md) |
| **Signature format** | OpenSSH `SSHSIG`, namespace `timda` |

## 1. Purpose

A Section speaks for itself by signing what it says with a key from its own `_timda` record. Anyone can check the signature by looking that record up. No accounts, names or emails are involved: the domain is the Section, and the key proves the statement came from whoever runs it.

The first use is **opting in**: a Section signs a request to dock, and the hub lists it once the signature checks out against the Section's DNS. Later uses (Board resolutions, mail between Sections, hub announcements) use the same format.

The key words MUST, SHOULD and MAY are used as in RFC 2119.

## 2. Keys

The signing keys are the ones in the signer's key records at `_key._timda.<domain>` (TIMDA-1 §5). Each converts directly into an OpenSSH public key:

| Record | OpenSSH key |
| --- | --- |
| `v=TIMDA1; key=ed25519:<b64>` | `ssh-ed25519`, wrapping the same 32 bytes |
| `v=TIMDA1; key=sk-ed25519:<b64>` | `sk-ssh-ed25519@openssh.com`, wrapping the same 32 bytes, application `ssh:` |

So a Section's existing SSH key works as-is. Publish its public half as a key record (§6 shows how), and sign with `ssh-keygen`.

Operators SHOULD use a dedicated key for TIMDA rather than their everyday login key. The `timda` namespace (§3) already stops a TIMDA signature being reused as anything else, but separate keys keep a leak in one place from affecting the other.

## 3. Signature format

Signatures use OpenSSH's [`SSHSIG` format](https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.sshsig): what `ssh-keygen -Y sign` produces.

- **Namespace:** MUST be `timda`. Verifiers MUST reject any other namespace. This binds the signature to TIMDA, so it can't be replayed as an SSH login, a Git commit signature, or anything else.
- **Hash:** `sha512` (`ssh-keygen`'s default). Verifiers MUST accept `sha512` and MAY accept `sha256`.
- **Encoding:** the armoured `-----BEGIN SSH SIGNATURE-----` text that `ssh-keygen` writes.

## 4. Statements

A statement is UTF-8 text with LF line endings, at most 4 KiB (8 KiB for a TIMDA-3 `message`). It starts with header lines, optionally followed by a blank line and a free-text body:

```
timda-statement: 1
type: dock-request
from: section72.net
hub: timda.space
issued: 2026-11-22T06:45:00Z
nonce: 5Mc20ZbIH__0tV57-Fwcag
```

Header rules:

1. Each line is `name: value`. Names are lowercase `[a-z0-9-]+`. Values are trimmed.
2. **`timda-statement: 1` comes first.** Any other version is unsupported.
3. **Each name appears at most once.** A duplicate makes the statement invalid.
4. **Unknown headers are ignored**, so new ones can be added without a new version.

Required headers:

| Header | Value |
| --- | --- |
| `type` | What the statement is (§5). |
| `from` | The signer's domain, lowercase, no trailing dot. The signature MUST verify against a key in **this domain's** `_timda` record. |
| `issued` | When it was signed: RFC 3339 UTC, for example `2026-11-22T06:45:00Z`. |
| `nonce` | At least 128 random bits, encoded as base64url or hex. Makes every statement unique. |

## 5. Statement types

### `dock-request`

The Section asks a hub to list it.

| Header | Value |
| --- | --- |
| `hub` | The hub's domain, such as `timda.space`. A hub MUST ignore requests addressed to another hub. |

When it receives one, the hub runs the checks in §7. If they pass, it adds `from` to its registry; a hub that reviews new Sections holds it there until it's approved (below). From then on, TIMDA-1 §8 applies: the Section is listed while its records stay valid, and leaving still only takes removing them (the InstaSafe Rapid Crew Detachment Detonation Disk). No "undock request" exists, on purpose: leaving never needs anyone's permission.

### Board resolutions: `board-agenda`, `board-approve`, `board-delist`, `board-reinstate`

How a hub's operator moderates, with no accounts or logins: statements signed with a key from the **hub's own** `_key._timda` records (`from:` is the hub's domain; anyone else's are refused).

| Header | Value |
| --- | --- |
| `hub` | The hub's domain. |
| `section` | The Section the resolution is about (not for `board-agenda`). |
| `reason` | Optional, for `board-delist`. |

- `board-agenda`: the hub replies with what's waiting for review, approved and delisted. Only the hub's key can see it.
- `board-approve`: list a Section that's waiting for review.
- `board-delist`: stop listing a Section at once, stop serving anything of it, and refuse its dock requests.
- `board-reinstate`: undo a delisting.

The authority behind a resolution is the same as for any statement: control of the hub's DNS, which is what publishes its keys. A hub that wants Board powers harder to misuse can publish only hardware (`sk-ed25519`) keys.

### `message`, `inbox`, `inbox-delete`

Site-to-site messages, held by a hub until the recipient collects them. See [TIMDA-3](0003-inbox.md).

### `announcement`

A free-text message in the body, from any Section, or from the hub with `from: timda.space`. Announcements are meant to be kept and shared, so §7's freshness check doesn't apply. The signature and the record lookup still do.

## 6. How to (the shoot)

**Publish your key.** Turn your SSH public key into the value for `key=`:

```console
$ node tools/timda.mjs key ~/.ssh/timda.pub
ed25519:BEU4U5TumcJctuiv9fWIub3FWunyt26V89cPTUZ/YQo=
```

That works for ordinary and hardware (`ed25519-sk`) keys. The full walk-through, including key rotation, is in the [docking guide](../guides/docking.md).

**Sign a dock request.**

```console
$ cat > dock.txt <<EOF
timda-statement: 1
type: dock-request
from: section72.net
hub: timda.space
issued: $(date -u +%Y-%m-%dT%H:%M:%SZ)
nonce: $(head -c 16 /dev/urandom | base64 | tr '+/' '-_' | tr -d =)
EOF
$ ssh-keygen -Y sign -f ~/.ssh/id_ed25519_timda -n timda dock.txt     # writes dock.txt.sig
```

**Verify anyone's statement** using nothing but DNS and `ssh-keygen`:

```console
$ node tools/timda.mjs signers section72.net > allowed_signers
$ ssh-keygen -Y verify -f allowed_signers -I section72.net -n timda -s dock.txt.sig < dock.txt
Good "timda" signature for section72.net with ED25519 key SHA256:…
```

`timda signers <domain>` prints one line per key in the record, with the domain as the principal and `namespaces="timda"`.

## 7. Verification

A verifier (normally the hub) MUST, in order:

1. **Parse the headers** (§4). Reject anything malformed, oversized, or of an unknown version.
2. **Look up the `from` domain's Section** (TIMDA-1: core first, then keys) and require it to be valid and unexpired. Hubs SHOULD resolve with DNSSEC validation.
3. **Verify the signature** with namespace `timda` against the Section's key records. Any one key verifying is enough.
4. **Check freshness**, unless the type says otherwise: `issued` within 10 minutes of the verifier's clock, in either direction.
5. **Check the nonce is new.** Remember every nonce accepted from each domain for at least 20 minutes, and reject repeats. Together with step 4, this stops replays.
6. **Check type-specific rules** (§5).

Keys are looked up when the statement is checked, never cached across statements, and never pinned (TIMDA-1 §9.1). So removing a key from DNS revokes it straight away, without any separate revocation list. Publishing a new key works just as fast, with no approval from the old key needed.

## 8. Hub operators

Hub operators are the keys in the hub's own key records, `_key._timda.<hub>`, one record per operator key. They sign the hub's announcements and its Board resolutions (§5). There are no logins and no accounts: a resolution is just a statement, checked like any other. A hub that wants its Board powers harder to misuse can publish only hardware (`sk-ed25519`) keys.

## 9. Security considerations

- **Control of DNS is authority.** Anyone who can change a Section's `_timda` record can swap its key and then sign as that Section. That's by design (TIMDA-1 §9). Protect registrar and DNS accounts, and use DNSSEC.
- **Replays** are handled by `issued` and `nonce` (§7). Statement types that skip the freshness check (`announcement`) must be harmless to replay.
- **Namespace separation** (§3) stops cross-protocol reuse of signatures, but not key compromise. Use a dedicated key.
- **Hardware keys** (`sk-ed25519`) keep the private key on the device, and can require a touch or PIN for every signature (`ssh-keygen -O verify-required`). They're recommended for hub operators.

## 10. Delivery

A hub takes statements over HTTPS at fixed paths under its own domain, so a sender needs nothing but the hub's name (the `hub:` header, or a recipient's inbox record):

| Path | Statements |
| --- | --- |
| `POST https://<hub>/api/dock` | `dock-request` |
| `POST https://<hub>/api/board` | `board-agenda`, `board-approve`, `board-delist`, `board-reinstate` |
| `POST https://<hub>/api/mail` | `message`, `inbox`, `inbox-delete` ([TIMDA-3](0003-inbox.md)) |

Each takes `multipart/form-data` with two fields: `statement` (the exact signed file) and `signature` (the `.sig`).

**Replies.** A request with `Accept: application/json` gets a JSON object: `{"ok": true, …}` with HTTP 200, or `{"ok": false, "error": "…"}` with HTTP 400 (503 if the hub can't take statements at all). The `error` is meant for people, so show it as it is. What else a reply carries depends on the type:

| Type | Reply fields |
| --- | --- |
| `dock-request` | `from`, `state` (`review` or `approved`), `already`, `name`, `status` |
| `board-agenda` | `review`, `approved`, `delisted` (lists of domains) |
| other `board-*` | `section` |
| `message` | `id`, `from`, `to`, `subject`, `encrypted`, `hub` |
| `inbox` | `mail`: a list of `{id, from, to, subject, received, encrypted, statement, signature}`, oldest first, with `statement` and `signature` exactly as signed |
| `inbox-delete` | `deleted`, `missing` (lists of IDs), `left` |

Without that header a hub may answer with a page for people instead. The reference hub's forms do exactly that, with no JavaScript: **`https://timda.space/dock`**, **`/executive-suites`** and **`/econopod#wormhole-post`**, and the `timda` command line tool speaks JSON. A pasted statement is also accepted. Browsers send pasted line breaks as CRLF, so the hub turns them back into LF and makes sure the text ends with one newline, which matches what `ssh-keygen` signed when the file was written the usual way.

## 11. Not yet covered

- **Travellers:** people with a key but no domain, and the key directory (the ComforPods). Deferred.

## 12. Versioning

**TIMDA-2 is stable.** A statement that verifies today will still be read the same way. New statement types, new optional headers (§4: unknown headers are ignored) and new reply fields (§10) can be added without a new version. Changing the meaning of an existing header or type, the signing format, or the namespace needs `timda-statement: 2` and a new spec number.

