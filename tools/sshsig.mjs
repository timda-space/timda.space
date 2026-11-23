// Verify OpenSSH SSHSIG signatures (what `ssh-keygen -Y sign` produces), for TIMDA-2.
// Pure WebCrypto: runs unchanged in Node 20+ and Cloudflare Workers.
// Format: https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.sshsig
// Keys: ssh-ed25519, and sk-ssh-ed25519@openssh.com (FIDO, application "ssh:").

const enc = new TextEncoder();
const dec = new TextDecoder();

class Reader {
  constructor(bytes) { this.b = bytes; this.o = 0; this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  take(n) { if (this.o + n > this.b.length) throw new Error('truncated SSH data'); const s = this.b.subarray(this.o, this.o + n); this.o += n; return s; }
  u32() { const n = this.take(4); return new DataView(n.buffer, n.byteOffset, 4).getUint32(0); }
  u8() { return this.take(1)[0]; }
  string() { return this.take(this.u32()); }
  get done() { return this.o === this.b.length; }
}

const b64decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64encode = (b) => btoa(String.fromCharCode(...b));
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const sshString = (b) => concat(u32(b.length), b);
const digest = async (alg, data) => new Uint8Array(await crypto.subtle.digest(alg, data));

/** Parse the armoured signature text. Throws with a readable message on anything malformed. */
export function parseSignature(armored) {
  const m = /-----BEGIN SSH SIGNATURE-----([\s\S]*?)-----END SSH SIGNATURE-----/.exec(armored);
  if (!m) throw new Error('not an SSH signature (no BEGIN/END SSH SIGNATURE block)');
  let blob;
  try { blob = b64decode(m[1].replace(/\s+/g, '')); } catch { throw new Error('signature is not valid base64'); }
  const r = new Reader(blob);
  if (dec.decode(r.take(6)) !== 'SSHSIG') throw new Error('not an SSHSIG signature');
  if (r.u32() !== 1) throw new Error('unsupported SSHSIG version');
  const sig = {
    publicKey: r.string(),
    namespace: dec.decode(r.string()),
    reserved: r.string(),
    hashAlg: dec.decode(r.string()),
    signature: r.string(),
  };
  if (!r.done) throw new Error('trailing data after signature');
  return sig;
}

/** The signing key, as a TIMDA-1 key value ("ed25519:<b64>" / "sk-ed25519:<b64>"). */
function keyOf(publicKey) {
  const r = new Reader(publicKey);
  const type = dec.decode(r.string());
  const pk = r.string();
  if (pk.length !== 32) throw new Error('signing key is not a 32-byte Ed25519 key');
  if (type === 'ssh-ed25519' && r.done) return { type, pk, spec: `ed25519:${b64encode(pk)}` };
  if (type === 'sk-ssh-ed25519@openssh.com') {
    const application = dec.decode(r.string());
    if (!r.done) throw new Error('malformed hardware key');
    if (application !== 'ssh:') throw new Error('hardware key uses a non-default FIDO application');
    return { type, pk, application, spec: `sk-ed25519:${b64encode(pk)}` };
  }
  throw new Error(`unsupported key type ${type} (TIMDA uses ed25519 or ed25519-sk)`);
}

async function ed25519Verify(pk, sig, data) {
  const key = await crypto.subtle.importKey('raw', pk, { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'Ed25519' }, key, sig, data);
}

/**
 * Verify `message` (Uint8Array) against an armoured SSHSIG.
 * allowedKeys: TIMDA-1 key values from the signer's _key._timda records.
 * Returns { ok: true, key } or { ok: false, error }.
 */
export async function verifySshsig({ message, armored, namespace, allowedKeys }) {
  let sig, key;
  try {
    sig = parseSignature(armored);
    key = keyOf(sig.publicKey);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (sig.namespace !== namespace) return { ok: false, error: `signature namespace is "${sig.namespace}", expected "${namespace}"` };
  const hash = { sha512: 'SHA-512', sha256: 'SHA-256' }[sig.hashAlg];
  if (!hash) return { ok: false, error: `unsupported hash ${sig.hashAlg}` };
  if (!allowedKeys.includes(key.spec)) return { ok: false, error: 'signed with a key that is not in the Section\'s _key._timda records' };

  const signedData = concat(
    enc.encode('SSHSIG'),
    sshString(enc.encode(namespace)),
    sshString(sig.reserved),
    sshString(enc.encode(sig.hashAlg)),
    sshString(await digest(hash, message)),
  );

  let ok = false;
  try {
    const r = new Reader(sig.signature);
    const sigType = dec.decode(r.string());
    if (sigType !== key.type) return { ok: false, error: 'signature type does not match its key' };
    const raw = r.string();
    if (raw.length !== 64) return { ok: false, error: 'malformed Ed25519 signature' };
    if (key.type === 'ssh-ed25519') {
      if (!r.done) return { ok: false, error: 'malformed signature' };
      ok = await ed25519Verify(key.pk, raw, signedData);
    } else {
      // FIDO: the authenticator signs sha256(application) || flags || counter || sha256(data)
      const flags = r.u8();
      const counter = r.u32();
      if (!r.done) return { ok: false, error: 'malformed signature' };
      if (!(flags & 0x01)) return { ok: false, error: 'hardware key signature without user presence (touch)' };
      const data = concat(await digest('SHA-256', enc.encode(key.application)), Uint8Array.of(flags), u32(counter), await digest('SHA-256', signedData));
      ok = await ed25519Verify(key.pk, raw, data);
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
  return ok ? { ok: true, key: key.spec } : { ok: false, error: 'signature does not verify' };
}
