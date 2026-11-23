# TIMDA-3: Inboxes

| | |
| --- | --- |
| **Status** | Draft: implemented by the reference hub, and open to change from what early users find, before it's called 1.0 |
| **Depends on** | [TIMDA-1](0001-finger-record.md), [TIMDA-2](0002-signed-statements.md) |

## 1. Purpose

Sections can send each other messages through a hub (the reference hub calls it the **Wormhole Post**). A message is a signed statement (TIMDA-2) from one Section to another; the hub checks it against the sender's DNS and holds it until the recipient picks it up. No accounts, names or passwords: a Section reads its inbox by signing a request with its own key.

Everything is opt-in. A Section receives nothing until it publishes an inbox record, and deleting the record closes the inbox.

The key words MUST, SHOULD and MAY are used as in RFC 2119.

## 2. The inbox record: `_inbox._timda.<domain>`

```
v=TIMDA1; hub=timda.space
v=TIMDA1; hub=timda.space; age=age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs3290gq
```

| Tag | Meaning |
| --- | --- |
| `hub=` | Required. The hub that holds this Section's inbox. Only that hub accepts messages for it. |
| `age=` | Optional. An [age](https://age-encryption.org) X25519 public key (`age1…`). If present, messages to this Section MUST be encrypted to it (§5). |

At most one inbox record; more than one closes the inbox (TIMDA-1 §2.1: ambiguity rejects). It uses the same TTL as the Section's other records.

A hub MUST accept a message only if the recipient has a valid TIMDA-1 Section **and** an inbox record naming that hub, both checked live when the message arrives.

## 3. Who can send

Only Sections. The sender's `from:` domain MUST have a valid Section, and the statement MUST verify against one of its current keys (TIMDA-2 §7). Every message is therefore accountable to a domain whose operator controls its DNS.

A hub MAY require more. The reference hub takes messages only between Sections it lists (approved, valid and unexpired), and to and from the hub itself, so it never holds mail for a domain it wouldn't show.

## 4. Statements

All three are TIMDA-2 statements, so they carry `from:`, `issued:` and `nonce:`, MUST be fresh (issued within 10 minutes) and are single-use (nonce).

### 4.1 `type: message`

```
timda-statement: 1
type: message
from: section72.net
to: section76.net
hub: timda.space
issued: 2026-11-22T12:00:00Z
nonce: 3q2-7wFhT0aQ9xM4kZ1bLw
subject: The modem on bench 3

Your station keeps answering our outside line. Is that you?
```

- `to:` the recipient's domain. `hub:` MUST be the hub it's sent to, and MUST match the recipient's inbox record.
- `subject:` optional, up to 100 characters, on one line like every header.
- The body is the message: plain text, or (§5) an age-armoured ciphertext.
- The whole statement is at most **8 KiB** (TIMDA-2's 4 KiB limit is raised for this type only).

### 4.2 `type: inbox` (read)

```
timda-statement: 1
type: inbox
from: section76.net
hub: timda.space
issued: 2026-11-22T12:05:00Z
nonce: Zq0Y3kT6b0x2wN8cR1vHsg
```

Signed by the recipient. The hub replies with every message it holds for `from:`, oldest first. Reading does **not** delete anything (§6).

### 4.3 `type: inbox-delete`

```
timda-statement: 1
type: inbox-delete
from: section76.net
hub: timda.space
issued: 2026-11-22T12:06:00Z
nonce: 9dJt1mQx5sV7aB3eK2wPzA
delete: 2f6c1e0a9b, 7d41aa03c2
```

`delete:` is a comma-separated list of message IDs (§6), or `all`.

## 5. Encryption (optional)

A Section that wants messages the hub can't read publishes an `age=` key in its inbox record. Then:

- Senders MUST encrypt the body with [age](https://age-encryption.org) to that key (`age -a -r age1…`), and add the header `encrypted: age`.
- The hub MUST reject a message without `encrypted: age` to an inbox that has an `age=` key, so nobody sends plaintext by mistake.
- The signature covers the ciphertext, so the recipient can still check who sent it.

The age key is separate from the Section's signing keys on purpose: signing keys can live in a hardware key or a password manager's SSH agent, which can sign but can't decrypt. The age key is a file (`age-keygen`) the recipient keeps.

Without `age=`, messages are signed but not encrypted, and **the hub can read them**. A hub MUST say so plainly in its charter.

## 6. Holding and delivery

- A hub takes these statements at `https://<hub>/api/mail` (TIMDA-2 §10), so anyone can deliver to an inbox knowing only its record. Running your own hub is how you hold your own mail.
- Each accepted message gets an ID: the first 10 hex characters of the SHA-256 of the signed statement.
- The hub stores the statement **and its signature, exactly as received**. On a read it returns both, so the recipient can verify the sender with nothing but `ssh-keygen` and DNS, without trusting the hub.
- Messages are kept for **30 days**, then deleted. Reading doesn't delete them, so a message is never lost by opening it. The recipient can delete sooner with `inbox-delete` (§4.3).
- A hub SHOULD limit messages per sender (the reference hub: 20 a day) and storage per inbox (the reference hub: 100 messages), and reject what's over the limit with a clear error rather than dropping anything silently.
- An `inbox` or `inbox-delete` statement MUST carry `hub:` naming the hub it's sent to, like a message, so it can't be replayed at another hub.
- Closing an inbox (deleting the record) stops new messages at once. Messages already held stay readable by the recipient until they expire.

## 7. Security considerations

- **The hub sees metadata.** Even with encryption it knows who messaged whom, and when. Don't use this for anything that needs that hidden.
- **Replay.** Statements are single-use (nonce) and must be fresh, so a captured `inbox` or `inbox-delete` can't be reused.
- **Forgery by the hub.** It can't forge a message: it doesn't hold the sender's key, and the recipient gets the original signature to check.
- **Abuse.** Senders are accountable to a domain; recipients can close their inbox at any time. Blocking individual senders is left for a later revision.
- **No sticky state** (TIMDA-1 §9.1) still holds: keys are read from DNS on every send and read, nothing is pinned, and an inbox lives exactly as long as its record.
