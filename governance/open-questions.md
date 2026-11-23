# Open questions

These are decisions that haven't been made yet. Anything listed here is still open, even if a draft spec assumes one answer for now.

## Finger record

- **Is TIMDA-1 ready to adopt?** A draft is in [`specs/0001-finger-record.md`](../specs/0001-finger-record.md). Still to confirm: the tag names, what `open`/`closed` mean, and the length limits.
- **Section numbers.** Who hands out Section numbers, and what happens if two domains both claim `name=Section 72`? The draft keys identity on the domain and treats `name` as free text, so the hub can't stop a collision yet.

## Keys and signing

Decided (see [TIMDA-2](../specs/0002-signed-statements.md)):

- **Signatures are OpenSSH `SSHSIG`, namespace `timda`.** Sections sign with `ssh-keygen`, and anyone verifies against the key in the Section's `_timda` record.
- **Opting in is a signed `dock-request`.** Opting out is still just removing the record.
- **Hardware keys** (`sk-ed25519`, such as a YubiKey) are allowed for anyone. They're recommended for hub operators, whose keys sign Board resolutions.

Still open:

- **Travellers** (people with a key but no domain) and the key directory. Deferred.

## Hub listings and routing

- **What *next* means.** The reference hub goes to the next open Section in alphabetical order by domain, wrapping round. Fine for now, but open to change.

## Joining

Decided: a Section asks to join with a signed `dock-request`, and the hub's Board reviews it before it's listed ([TIMDA-1 §8.1](../specs/0001-finger-record.md), [TIMDA-2 §5](../specs/0002-signed-statements.md)). Leaving still needs nobody's approval. A hub can choose to list without review instead.

## BBS and web

- **Same station or sister stations?** Either the BBS and the web version are one station reached by different transit (BBS = service corridor, web = main concourse), or they're sister stations run by the same company. Time travel is ruled out (too TARDIS).
- **Whether the two connect, and how.** Could a BBS Section publish a `_timda` record? Should the record get a tag for a dial-in or telnet address?

## Art

- **The station art is CC BY-NC-ND 4.0** (see [the look](../concepts/look.md#where-it-came-from-and-the-licence)). Stay non-commercial, credit it, and publish only the unmodified image. To publish the extended, lettered version, ask Useless Pursuit for permission first, through their itch.io page.
- **The original file.** The current art was recovered from a screenshot. Re-export from the generator's Windows version (press Space, and the PNG is saved to Documents), then replace `concepts/art/station-320x180.png` and the website's `public/art/station.png`.

## Housekeeping

