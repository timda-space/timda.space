# Docking a Section

How to bring a domain aboard. **Make the key first, then publish the records.** A Section without a key record is invalid (TIMDA-1 §2.1), so there's no state where your Section is listed but nobody holds its key.

The specs: [TIMDA-1](../specs/0001-finger-record.md) (the records), [TIMDA-2](../specs/0002-signed-statements.md) (signing), [TIMDA-3](../specs/0003-inbox.md) (mail).

## 1. Make a key

Use a key just for TIMDA, not your everyday SSH key.

```console
$ ssh-keygen -t ed25519 -C "" -f ~/.ssh/timda
```

Or, to keep it on a hardware key such as a YubiKey, which asks for a touch and PIN to sign:

```console
$ ssh-keygen -t ed25519-sk -O verify-required -C "" -f ~/.ssh/timda
```

`-C ""` leaves out the comment. It wouldn't be published anyway, but this keeps your username and hostname out of the file.

## 2. Plan every record in one go

Generate the full set from one command, so the pieces can't disagree:

```console
$ node tools/timda.mjs plan section72.net --name "Section 72" --status open \
    --key ~/.ssh/timda.pub --concept "…" > section72.zone
```

```zone
_timda.section72.net.      300 IN TXT "v=TIMDA1; name=Section 72; status=open; concept=…"
_key._timda.section72.net. 300 IN TXT "v=TIMDA1; key=ed25519:BEU4U5TumcJctuiv9fWIub3FWunyt26V89cPTUZ/YQo="
```

Or keep your settings in a file: `node tools/timda.mjs init section72.net > section.toml`, fill it in, and run `node tools/timda.mjs plan --from section.toml`. Re-run it whenever you change something.

That's the minimum: a **core** record and one **key** record. Options:

- `--key` again for every extra key (a .pub file, or an `ed25519:…` value): a backup hardware key, a second operator. Each key gets its own record, up to 8.
- `--airlock <url>`: where visitors arrive from the hub. It must be on your own domain, and defaults to your homepage. The convention is a path on your own domain: `https://<your domain>/airlock`, `/charter`, `/setting`. Say plainly there what's really on offer and how to use it.
- `--charter <url>`: your definitive, out-of-character page: the conditions of using your Section, what you log or keep, moderation, and how to reach you. No names needed: a signed message to your key or an alias is enough. It overrides anything said in character, and must be on your own domain.
- `--setting <url>`: your place's setting: what it is in-world, its lore and history. It can live anywhere, a wiki included.
- `--expires 2027-01-04`: for a pop-up place. After that date it's delisted automatically.
- `--ttl 300`: the default. Every record gets the same TTL so caches expire them together.

`timda plan` checks what it produced and complains if anything's wrong. To check a zone file you've edited by hand:

```console
$ node tools/timda.mjs check section72.zone section72.net
```

## 3. Publish

If your DNS is on Cloudflare and you use OpenTofu, the [`timda-section` module](../infra/modules/timda-section) publishes the same records from code. Otherwise, add each line as a TXT record in your DNS. On Cloudflare, the name is everything before your domain (`_timda`, `_key._timda`, …), and the content is the quoted text without the quotes.

## 4. Check it from the outside

```console
$ node tools/timda.mjs finger section72.net
```

You should see exactly what `timda check` showed, ending in a **Checks** list. Anything **CRIT** (red) has to be fixed before the Section counts. **WARN** (amber) is worth fixing but doesn't block anything. If it doesn't match what you published, wait one TTL (DNS caches) and look again.

## 5. Ask to dock

Do this once your records are published and `finger` looks right. Either way, the hub checks the signature against your live records, and you have 10 minutes between signing and uploading.

**The easy way.** `timda init section72.net > section.toml` writes the settings file that `plan --from section.toml` read in step 2. From the folder holding it:

```console
$ node /path/to/timda.space/tools/timda.mjs dock --from section.toml
```

(After `npm link` in this repo, that's just `timda dock`.) It writes the request, signs it with your key through `ssh-keygen`, and sends it to the hub.

**By hand.** Write the request, sign it, then upload `dock.txt` and `dock.txt.sig` at **https://timda.space/dock**:

```console
$ cat > dock.txt <<EOF
timda-statement: 1
type: dock-request
from: section72.net
hub: timda.space
issued: $(date -u +%Y-%m-%dT%H:%M:%SZ)
nonce: $(head -c 16 /dev/urandom | base64 | tr '+/' '-_' | tr -d =)
EOF
$ ssh-keygen -Y sign -f ~/.ssh/timda -n timda dock.txt
```

(The fields are in TIMDA-2 §6.) The hub adds you to its registry, where you wait for the Board's review: nothing of you is listed until you're approved. Once approved, while your status is `pending` you show greyed out in the HyperMall, and visitors aren't sent your way. `init` and `plan` both start you at `pending`; when you're ready to go live, change it to `open` and publish the records again. Then you have a link to your airlock and a place on the ring.

To send visitors round the ring from your own site, link to `https://timda.space/next?from=<your domain>` and `https://timda.space/random`.

You can check your own signature exactly as the hub will:

```console
$ node tools/timda.mjs signers section72.net > allowed_signers
$ ssh-keygen -Y verify -f allowed_signers -I section72.net -n timda -s dock.txt.sig < dock.txt
```


## Put the launch button on your site

Once you're docked, add the station's 88×31 launch button. It sends visitors through a random wormhole. Download `timda-88x31.png` and `timda-176x62.png` (from [timda.space/dock](https://timda.space/dock#launch-button), or from [`concepts/art/`](../concepts/art/) in this repo) and host them yourself, so your visitors' browsers don't contact the hub until they click. The `src` paths below are where *you* put them on your own site:

```html
<a href="https://timda.space/random"><img src="/timda-88x31.png"
  srcset="/timda-176x62.png 2x" width="88" height="31"
  alt="TIMDA: launch to a random Section"></a>
```

Links round the ring, with your own domain in `from=` so *next* knows where you are:

```html
<a href="https://timda.space/">TIMDA</a> ·
<a href="https://timda.space/next?from=section72.net">Next Section</a> ·
<a href="https://timda.space/random">Random</a>
```

The button is drawn from the hub's own pixel icon, not the station art, so it's free to use on any Section.

### Your own button

Got an 88×31 of your own? Publish it and the HyperMall shows it on your storefront:

```zone
_button._timda.section72.net. 300 IN TXT "v=TIMDA1; url=https://section72.net/88x31.png"
```

It must be a PNG or GIF, exactly 88×31 (or 176×62 for sharp screens), at most 16 KiB, and hosted on your own domain. The hub fetches it, checks it, and serves its own copy, so the HyperMall never makes visitors' browsers contact your site. `finger` fetches it too and tells you whether it passes.

### A banner for the Observation Lounge

The hub's Observation Lounge rotates 468×60 banners from open Sections that opt in. Publish one, with an optional caption of up to 140 characters:

```zone
_banner._timda.section72.net. 300 IN TXT "v=TIMDA1; url=https://section72.net/468x60.png; caption=The 90s, in the future."
```

Same rules as the button, but 468×60 (or 936×120), at most 64 KiB. `node tools/timda.mjs plan … --banner URL --caption "…"` writes the record for you, encoding anything that needs it.

## Rotating a key

Each key is its own record, so rotating is just adding one and removing another. There's never a moment without a working key.

**Planned rotation:**

1. Make the new key (step 1).
2. **Add** a key record for it. Leave the old one in place.
3. Wait at least one TTL, so the new record is visible everywhere.
4. Start signing with the new key.
5. **Delete** the old key's record.

Both keys verify during the overlap, so nothing is rejected at any point.

**If a key is lost:** add a key record for a new one and delete the lost one. There's nothing to recover. The old key had no special standing, and the new key needs no one's approval.

**If a key is stolen:** **delete** its record first, then add the new one. The stolen key stops working as soon as DNS updates. Statements you sign in the next few minutes may be rejected by resolvers that still have old records cached. Wait one TTL and resend.

**Every failure rejects.** A statement signed before DNS has caught up is turned away, never accepted under the wrong key. Since nothing is pinned or remembered (TIMDA-1 §9.1), trying again after a TTL always works.

## Undocking

Delete the core `_timda` record. Without it nothing else counts, so you're delisted at the hub's next check, and nobody's permission is involved. Clean up the other records whenever you like. To come back, publish the core again (unless the hub delisted you).

## A backup key

If you use a hardware key, publish a key record for a **second hardware key** too, and keep that one somewhere safe. If the first is lost or broken, you can sign with the backup straight away, with no DNS change needed.
