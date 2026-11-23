// Reference implementation of TIMDA-1 finger records (specs/0001-finger-record.md)
// and the SSH interop used by TIMDA-2. No dependencies; runs in Node 18+,
// browsers, and Cloudflare Workers.
//
// A Section is several TXT records under _timda.<domain>:
//   _timda.<d>            the core (name, status, type, concept, expires, auth)
//   _key._timda.<d>       one key per record, 1..8
//   _airlock._timda.<d>   _charter._timda.<d>   _setting._timda.<d>   one URL each
//   _button._timda.<d>    one URL: the Section's 88x31 button image
//   _banner._timda.<d>    one URL (and an optional caption): a 468x60 banner
//   _inbox._timda.<d>     where the Section takes messages, and its age key (TIMDA-3)
// assembleSection() combines them, following the consistency rules in §2.1.

export const VERSION = 'TIMDA1';

/** The DNS name for each piece of a Section. */
export const PARTS = {
  core: '_timda',
  key: '_key._timda',
  airlock: '_airlock._timda',
  charter: '_charter._timda',
  setting: '_setting._timda',
  button: '_button._timda',
  banner: '_banner._timda',
  inbox: '_inbox._timda',
};
export const LINKS = ['airlock', 'charter', 'setting', 'button', 'banner'];
export const recordName = (part, domain) => `${PARTS[part]}.${domain}`;

const LIMITS = { name: 48, concept: 120 };
const MAX_KEYS = 8;
// 32-byte Ed25519 public keys. sk-ed25519 is FIDO/hardware-backed
// (OpenSSH sk-ssh-ed25519@openssh.com, application "ssh:").
const KEY_ALGS = new Set(['ed25519', 'sk-ed25519']);
const ED25519_B64_RE = /^[A-Za-z0-9+/]{43}=$/;
const STATUSES = new Set(['open', 'closed', 'pending']);
const TYPES = new Set(['section', 'place', 'hub']);
const AUTH_TOKENS = new Set(['passkey', 'pubkey', 'none']);
const CORE_TAGS = new Set(['v', 'name', 'status', 'type', 'concept', 'expires', 'auth']);
const MOVED_TAGS = { key: PARTS.key, airlock: PARTS.airlock, charter: PARTS.charter, setting: PARTS.setting, button: PARTS.button, banner: PARTS.banner };

const TAG_RE = /^([a-z][a-z0-9-]*)[ \t]*=[ \t]*(.*)$/s;
const VALUE_RE = /^(?:[\x20-\x24\x26-\x3a\x3c-\x7e]|%[0-9A-Fa-f]{2})*$/;
const PREFIX_RE = /^[ \t]*v[ \t]*=[ \t]*TIMDA/;
const EXPIRES_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})Z)?$/;

const codePoints = (s) => [...s].length;

// ---- generic tag-value parsing ---------------------------------------------

function decodeValue(raw) {
  if (!VALUE_RE.test(raw)) return null;
  const bytes = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '%') {
      bytes.push(parseInt(raw.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(raw.charCodeAt(i));
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

/** True if a TXT string claims to be a TIMDA record of any version. */
export function isTimdaRecord(text) {
  return PREFIX_RE.test(text);
}

/**
 * Split one record into decoded tags.
 * Returns { status: 'ok' | 'invalid' | 'unsupported', tags?: Map, error? }.
 */
export function parseTags(text) {
  const parts = text.split(';').map((p) => p.trim());
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop(); // one trailing ';' is allowed
  const tags = new Map();
  for (const [i, part] of parts.entries()) {
    if (part === '') return { status: 'invalid', error: `empty tag at position ${i + 1}` };
    const m = TAG_RE.exec(part);
    if (!m) return { status: 'invalid', error: `malformed tag: ${JSON.stringify(part)}` };
    const [, key, raw] = m;
    if (i === 0 && key !== 'v') return { status: 'invalid', error: 'first tag must be v=' };
    if (tags.has(key)) return { status: 'invalid', error: `duplicate tag: ${key}` };
    const value = decodeValue(raw);
    if (value === null) return { status: 'invalid', error: `bad characters or encoding in ${key}=` };
    tags.set(key, value);
  }
  const v = tags.get('v');
  if (v !== VERSION) {
    if (typeof v === 'string' && v.startsWith('TIMDA')) return { status: 'unsupported', error: `unsupported version: ${v}` };
    return { status: 'invalid', error: 'not a TIMDA record' };
  }
  return { status: 'ok', tags };
}

// ---- helpers ------------------------------------------------------------------

function onDomain(host, domain) {
  const h = host.toLowerCase().replace(/\.$/, '');
  const d = domain.toLowerCase().replace(/\.$/, '');
  return h === d || h.endsWith(`.${d}`);
}

function httpsUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

// Canonical padded base64 of exactly 32 bytes. (Checks encoding only, not that the point is on the curve.)
function ed25519KeyOk(b64) {
  if (!ED25519_B64_RE.test(b64)) return false;
  try {
    const bin = atob(b64);
    return bin.length === 32 && btoa(bin) === b64;
  } catch {
    return false;
  }
}

function parseExpires(value) {
  const m = EXPIRES_RE.exec(value);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  const t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const back = new Date(t);
  // reject impossible dates like 2026-02-31
  if (back.getUTCFullYear() !== +y || back.getUTCMonth() !== +mo - 1 || back.getUTCDate() !== +d) return null;
  return back;
}

/** Where the hub's wormhole goes: the airlock, or the domain root. */
export function airlockUrl(domain, section) {
  return section.airlock ?? `https://${domain}/`;
}

// ---- the core record ----------------------------------------------------------

/**
 * Parse the core record at _timda.<domain>.
 * Returns { status: 'valid' | 'invalid' | 'unsupported', core?, errors, warnings }.
 */
export function parseCore(text) {
  const errors = [];
  const warnings = [];
  const t = parseTags(text);
  if (t.status !== 'ok') return { status: t.status, errors: [t.error], warnings };
  const { tags } = t;

  for (const key of ['name', 'status']) if (!tags.get(key)) errors.push(`missing required tag: ${key}`);
  for (const [key, max] of Object.entries(LIMITS)) {
    const val = tags.get(key);
    if (val !== undefined && codePoints(val) > max) errors.push(`${key}= is longer than ${max} characters`);
  }

  const core = { v: VERSION, name: tags.get('name'), status: tags.get('status') };
  if (core.status && !STATUSES.has(core.status)) errors.push(`unknown status: ${core.status}`);
  core.type = tags.get('type') ?? 'section';
  if (!TYPES.has(core.type)) errors.push(`unknown type: ${core.type}`);
  if (tags.has('concept')) core.concept = tags.get('concept');

  if (tags.has('expires')) {
    const when = parseExpires(tags.get('expires'));
    if (when) core.expires = when.toISOString();
    else errors.push('expires= must be YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ');
  }

  if (tags.has('auth')) {
    core.auth = [];
    for (const tok of tags.get('auth').split(',').map((s) => s.trim()).filter(Boolean)) {
      if (AUTH_TOKENS.has(tok)) core.auth.push(tok);
      else warnings.push(`unknown auth token ignored: ${tok}`);
    }
  }

  for (const key of tags.keys()) {
    if (CORE_TAGS.has(key)) continue;
    if (MOVED_TAGS[key]) warnings.push(`${key}= doesn't belong in the core; publish it at ${MOVED_TAGS[key]}.<domain>`);
    else warnings.push(`unknown tag ignored: ${key}`);
  }

  if (errors.length) return { status: 'invalid', errors, warnings };
  return { status: 'valid', core, errors, warnings };
}

// ---- key and link records -----------------------------------------------------

/** One _key._timda record -> { key: "alg:b64" } or { warning }. */
export function parseKeyRecord(text) {
  const t = parseTags(text);
  if (t.status !== 'ok') return { warning: `key record ignored: ${t.error}` };
  const spec = t.tags.get('key');
  if (!spec) return { warning: 'key record ignored: no key=' };
  const m = /^([a-z][a-z0-9-]*):(.+)$/.exec(spec.trim());
  if (!m) return { warning: `key record ignored: malformed key ${JSON.stringify(spec)}` };
  const [, alg, data] = m;
  // A common slip: pasting the OpenSSH public key (ssh-ed25519 AAAAC3…) instead of the
  // converted value. Say exactly how to fix it.
  const fromPub = 'is an OpenSSH public key, not the record value; convert it with: timda key <file.pub>';
  if (/^(ssh-ed25519|sk-ssh-ed25519@openssh\.com)$/.test(alg) || /^AAAA[A-Za-z0-9+/]/.test(data)) {
    return { warning: `key record ignored: ${alg}:… ${fromPub}` };
  }
  if (!KEY_ALGS.has(alg)) return { warning: `key record ignored: unknown algorithm ${alg}` };
  if (!ed25519KeyOk(data)) return { warning: `key record ignored: ${alg} key is not 32 bytes of canonical padded base64` };
  return { key: `${alg}:${data}` };
}

export const CAPTION_MAX = 140;

// age X25519 recipients: "age1" and 58 bech32 characters (https://age-encryption.org/v1).
export const AGE_RE = /^age1[02-9ac-hj-np-z]{58}$/;

/** The _inbox._timda record (TIMDA-3 §2) -> { hub, age? } or { warning }. */
export function parseInboxRecord(text) {
  const t = parseTags(text);
  if (t.status !== 'ok') return { warning: `inbox closed: ${t.error}` };
  const hub = (t.tags.get('hub') ?? '').toLowerCase();
  if (!HOST_RE.test(hub)) return { warning: 'inbox closed: hub= must name a hub\'s domain' };
  const age = t.tags.get('age');
  if (age === undefined) return { hub };
  if (!AGE_RE.test(age)) return { warning: 'inbox closed: age= is not an age X25519 public key (age1…)' };
  return { hub, age };
}

/**
 * One link record -> { url, caption? } or { warning }. Enforces same-domain for
 * everything but setting. Only the banner may carry a caption (TIMDA-1 §6.2).
 */
export function parseLinkRecord(part, text, domain) {
  const t = parseTags(text);
  if (t.status !== 'ok') return { warning: `${part} ignored: ${t.error}` };
  const url = httpsUrl(t.tags.get('url') ?? '');
  if (!url) return { warning: `${part} ignored: url= is not a valid https: URL` };
  if (part !== 'setting' && domain && !onDomain(new URL(url).hostname, domain)) {
    return { warning: `${part} ignored: must be on ${domain} or a subdomain` };
  }
  const caption = t.tags.get('caption');
  if (caption === undefined) return { url };
  if (part !== 'banner') return { url, warning: `${part}: caption= is only for the banner; ignored` };
  if ([...caption].length > CAPTION_MAX) return { url, warning: `banner caption ignored: over ${CAPTION_MAX} characters` };
  return { url, caption };
}

// ---- buttons ---------------------------------------------------------------------

/** A button is a PNG or GIF of exactly one of these sizes (1x, or 2x for sharp screens). */
export const BUTTON_SIZES = [[88, 31], [176, 62]];
export const BUTTON_MAX_BYTES = 16 * 1024;
/** A banner likewise: the classic 468x60 full banner (TIMDA-1 §6.2). */
export const BANNER_SIZES = [[468, 60], [936, 120]];
export const BANNER_MAX_BYTES = 64 * 1024;

/**
 * Check a button image's bytes without decoding it: the file signature and the
 * dimensions in its header. Returns { ok: true, type, width, height } or
 * { ok: false, error }. SVG and everything else is refused: a hub re-serves
 * buttons from its own origin, so it must only ever serve plain raster images.
 */
export function checkButtonImage(bytes) {
  return checkImage(bytes, { what: 'button', sizes: BUTTON_SIZES, maxBytes: BUTTON_MAX_BYTES });
}

/** The same checks for a banner: 468x60 (or 936x120), at most 64 KiB. */
export function checkBannerImage(bytes) {
  return checkImage(bytes, { what: 'banner', sizes: BANNER_SIZES, maxBytes: BANNER_MAX_BYTES });
}

function checkImage(bytes, { what, sizes, maxBytes }) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length > maxBytes) return { ok: false, error: `${what} is ${b.length} bytes; the limit is ${maxBytes}` };
  let type, width, height;
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ascii = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length >= 24 && png.every((v, i) => b[i] === v) && ascii(12, 4) === 'IHDR') {
    type = 'image/png';
    const dv = new DataView(b.buffer, b.byteOffset, b.length);
    width = dv.getUint32(16); height = dv.getUint32(20);
  } else if (b.length >= 10 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) {
    type = 'image/gif';
    width = b[6] | (b[7] << 8); height = b[8] | (b[9] << 8);
  } else {
    return { ok: false, error: `${what} must be a PNG or GIF` };
  }
  if (!sizes.some(([w, h]) => w === width && h === height)) {
    const [[w1, h1], [w2, h2]] = sizes;
    return { ok: false, error: `${what} is ${width}x${height}; it must be ${w1}x${h1} (or ${w2}x${h2} for sharp screens)` };
  }
  return { ok: true, type, width, height };
}

// ---- assembling a Section -----------------------------------------------------

/**
 * Combine everything found under _timda for a domain.
 * `found` maps part -> array of TXT strings (each with its character-strings joined):
 *   { core: [...], key: [...], airlock: [...], charter: [...], setting: [...] }
 * Returns { status, section?, errors, warnings } where status is
 *   'none' (no core), 'unsupported', 'invalid', 'expired' or 'valid'.
 */
export function assembleSection(domain, found, now = new Date()) {
  const ours = (txts) => (txts ?? []).filter(isTimdaRecord);
  const warnings = [];

  const cores = ours(found.core);
  if (cores.length === 0) return { status: 'none', errors: [], warnings };
  if (cores.length > 1) return { status: 'invalid', errors: [`found ${cores.length} core records at _timda.${domain}; there must be exactly one`], warnings };
  const c = parseCore(cores[0]);
  warnings.push(...c.warnings);
  if (c.status !== 'valid') return { status: c.status, errors: c.errors, warnings };
  const section = { ...c.core };

  // keys
  const keys = [];
  for (const txt of ours(found.key)) {
    const k = parseKeyRecord(txt);
    if (k.warning) warnings.push(k.warning);
    else if (!keys.includes(k.key)) keys.push(k.key);
  }
  if (keys.length > MAX_KEYS) warnings.push(`${keys.length} keys published; only the first ${MAX_KEYS} are used`);
  section.key = keys.slice(0, MAX_KEYS);

  // links
  for (const part of LINKS) {
    const recs = ours(found[part]);
    if (recs.length > 1) { warnings.push(`${part} ignored: ${recs.length} records at ${PARTS[part]}.${domain}; there must be at most one`); continue; }
    if (recs.length === 1) {
      const l = parseLinkRecord(part, recs[0], domain);
      if (l.warning) warnings.push(l.warning);
      if (l.url) section[part] = l.url;
      if (l.caption) section.caption = l.caption;
    }
  }

  // inbox (TIMDA-3): at most one; anything ambiguous or malformed closes it
  const inbox = ours(found.inbox);
  if (inbox.length > 1) warnings.push(`inbox closed: ${inbox.length} records at ${PARTS.inbox}.${domain}; there must be at most one`);
  else if (inbox.length === 1) {
    const ib = parseInboxRecord(inbox[0]);
    if (ib.warning) warnings.push(ib.warning);
    else section.inbox = ib;
  }

  if (section.key.length === 0) {
    return { status: 'invalid', errors: [`no usable key at ${PARTS.key}.${domain}`], warnings, section };
  }
  if (section.expires && new Date(section.expires) <= now) {
    return { status: 'expired', errors: [`expired at ${section.expires}`], warnings, section };
  }
  return { status: 'valid', section, errors: [], warnings };
}

// ---- zone files: planning and checking --------------------------------------

/**
 * Split DNS presentation-format TXT data ("abc" "def") into its joined content.
 * Handles \" \\ and \DDD escapes. Bytes are mapped 1:1 to chars so non-ASCII fails validation.
 */
export function joinPresentationTxt(data) {
  let out = '';
  let i = 0;
  while (i < data.length) {
    if (data[i] !== '"') { i++; continue; }
    i++;
    while (i < data.length && data[i] !== '"') {
      if (data[i] === '\\') {
        const ddd = /^\d{3}/.exec(data.slice(i + 1, i + 4));
        if (ddd) { out += String.fromCharCode(Number(ddd[0])); i += 4; }
        else { out += data[i + 1] ?? ''; i += 2; }
      } else {
        out += data[i++];
      }
    }
    i++; // closing quote
  }
  return out;
}

/**
 * Read zone-file TXT lines for one domain.
 * Returns { found, ttls: Map(part -> Set of TTLs), warnings }.
 */
export function parseZone(text, domain) {
  const d = domain.toLowerCase().replace(/\.$/, '');
  const byName = new Map(Object.keys(PARTS).map((p) => [recordName(p, d), p]));
  const found = {};
  const ttls = new Map();
  const warnings = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(\S+)\s+(?:(\d+)\s+)?(?:IN\s+)?TXT\s+(".*)$/i.exec(line);
    if (!m) continue;
    const name = m[1].toLowerCase().replace(/\.$/, '');
    const part = byName.get(name);
    if (!part) continue;
    (found[part] ??= []).push(joinPresentationTxt(m[3]));
    if (m[2]) (ttls.get(part) ?? ttls.set(part, new Set()).get(part)).add(Number(m[2]));
  }
  const all = new Set([...ttls.values()].flatMap((s) => [...s]));
  if (all.size > 1) warnings.push(`records use different TTLs (${[...all].join(', ')}); use one TTL for all of them so caches expire them together`);
  for (const t of all) if (t > 3600) warnings.push(`TTL ${t} is over an hour; changes will be slow to take effect`);
  return { found, ttls, warnings };
}

function encodeValue(s) {
  return [...new TextEncoder().encode(s)]
    .map((b) => (b < 0x20 || b > 0x7e || b === 0x25 || b === 0x3b ? `%${b.toString(16).toUpperCase().padStart(2, '0')}` : String.fromCharCode(b)))
    .join('');
}

/**
 * Plan the full set of records for a Section from one set of inputs.
 * opts: { name, status, type?, concept?, expires?, auth?: [], keys: ["alg:b64", ...],
 *         airlock?, charter?, setting?, button?, banner?, caption?, inbox?, age?, ttl? }
 * Returns zone-file text. Check it with parseZone + assembleSection.
 */
export function planZone(domain, opts) {
  return renderPlan(planRecords(domain, opts), 'zone');
}

/**
 * The same plan as rows: { domain, ttl, records: [{ name, content }] }, one per TXT
 * record, names fully qualified without a trailing dot, contents already encoded.
 */
export function planRecords(domain, opts) {
  const d = domain.toLowerCase().replace(/\.$/, '');
  const ttl = opts.ttl ?? 300;
  const core = [`v=${VERSION}`, `name=${encodeValue(opts.name ?? '')}`, `status=${opts.status ?? ''}`];
  if (opts.type && opts.type !== 'section') core.push(`type=${opts.type}`);
  if (opts.concept) core.push(`concept=${encodeValue(opts.concept)}`);
  if (opts.expires) core.push(`expires=${opts.expires}`);
  if (opts.auth?.length) core.push(`auth=${opts.auth.join(',')}`);
  const records = [{ name: recordName('core', d), content: core.join('; ') }];
  for (const k of opts.keys ?? []) records.push({ name: recordName('key', d), content: `v=${VERSION}; key=${k}` });
  for (const part of LINKS) {
    if (!opts[part]) continue;
    const caption = part === 'banner' && opts.caption ? `; caption=${encodeValue(opts.caption)}` : '';
    records.push({ name: recordName(part, d), content: `v=${VERSION}; url=${encodeValue(opts[part])}${caption}` });
  }
  if (opts.inbox) records.push({ name: recordName('inbox', d), content: `v=${VERSION}; hub=${encodeValue(opts.inbox)}${opts.age ? `; age=${encodeValue(opts.age)}` : ''}` });
  return { domain: d, ttl, records };
}

/** TXT content as DNS character-strings of at most 255 bytes (all ASCII here). */
export const txtStrings = (content) => content.match(/.{1,255}/gs) ?? [''];

// Quoting for zone files, and for HCL (where ${ and %{ would start a template).
const zoneQuote = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const hcl = (s) => zoneQuote(s).replace(/\$\{/g, () => '$${').replace(/%\{/g, () => '%%{');

/**
 * A plan in one of several formats, so it works with any DNS host:
 *   'zone'        a BIND zone-file fragment (most DNS hosts can import one)
 *   'table'       name / type / TTL / content, for typing into a web dashboard
 *   'cloudflare'  OpenTofu/Terraform, cloudflare/cloudflare provider v5
 *   'route53'     OpenTofu/Terraform, hashicorp/aws provider (one record set per name)
 */
export function renderPlan({ domain, ttl, records }, format) {
  const short = (name) => (name === domain ? '@' : name.slice(0, -(domain.length + 1)));
  const id = (name) => short(name).replace(/^_/, '').replace(/[^a-z0-9]+/gi, '_');
  if (format === 'zone') {
    const w = Math.max(...records.map(({ name }) => name.length + 1));
    return records.map(({ name, content }) => `${`${name}.`.padEnd(w)} ${ttl} IN TXT ${txtStrings(content).map(zoneQuote).join(' ')}`).join('\n') + '\n';
  }
  if (format === 'table') {
    return records.map(({ name, content }) => `Name:    ${short(name)}   (in full: ${name})\nType:    TXT\nTTL:     ${ttl}\nContent: ${content}\n`).join('\n');
  }
  if (format === 'cloudflare') {
    const blocks = records.map(({ name, content }, i) => [
      `resource "cloudflare_dns_record" "timda_${id(name)}_${i}" {`,
      '  zone_id = var.zone_id',
      `  name    = ${hcl(name)}`,
      '  type    = "TXT"',
      `  content = ${hcl(`"${content}"`)}`,
      `  ttl     = ${ttl}`,
      '}',
    ].join('\n'));
    return [`# TIMDA records for ${domain} (cloudflare/cloudflare ~> 5)`, 'variable "zone_id" { type = string }', ...blocks].join('\n\n') + '\n';
  }
  if (format === 'route53') {
    const byName = new Map();
    for (const r of records) byName.set(r.name, [...(byName.get(r.name) ?? []), r.content]);
    const blocks = [...byName].map(([name, contents]) => [
      `resource "aws_route53_record" "timda_${id(name)}" {`,
      '  zone_id = var.zone_id',
      `  name    = ${hcl(name)}`,
      '  type    = "TXT"',
      `  ttl     = ${ttl}`,
      '  records = [',
      // Route 53 takes one string per record; values over 255 bytes are split with "".
      ...contents.map((c) => `    ${hcl(txtStrings(c).join('""'))},`),
      '  ]',
      '}',
    ].join('\n'));
    return [`# TIMDA records for ${domain} (hashicorp/aws, Route 53)`, 'variable "zone_id" { type = string }', ...blocks].join('\n\n') + '\n';
  }
  throw new Error(`unknown format: ${format}`);
}

// ---- live lookups and checks (shared by the timda CLI and the hub) -------------

export const DOH = 'https://cloudflare-dns.com/dns-query';
export const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;
const DEFAULT_TTL = 300;

/** One TXT lookup over DoH: the strings, the shortest TTL, and whether DNSSEC validated. */
async function txtLookup(name, fetchImpl) {
  const res = await fetchImpl(`${DOH}?name=${encodeURIComponent(name)}&type=TXT`, { headers: { accept: 'application/dns-json' } });
  if (!res.ok) throw new Error(`DNS lookup failed (HTTP ${res.status})`);
  const body = await res.json();
  if (body.Status !== 0 && body.Status !== 3) throw new Error(`DNS lookup failed for ${name} (rcode ${body.Status})`);
  const answers = (body.Answer ?? []).filter((a) => a.type === 16);
  const ttls = [...answers, ...(answers.length ? [] : body.Authority ?? [])].map((a) => a.TTL).filter(Number.isFinite);
  return { txts: answers.map((a) => joinPresentationTxt(a.data)), ttl: ttls.length ? Math.min(...ttls) : undefined, ad: body.AD === true };
}

/**
 * Look a Section up live: the core first, the rest only if there's a core (TIMDA-1 §8.3).
 * Returns assembleSection()'s result plus `ttl` (the shortest TTL read, so a check is
 * never reused for longer than any record allows) and `dnssec` (every answer validated).
 */
export async function lookupSection(domain, { fetchImpl = fetch, now = new Date() } = {}) {
  const core = await txtLookup(recordName('core', domain), fetchImpl);
  const found = { core: core.txts };
  const ttls = [core.ttl];
  let dnssec = core.ad;
  if (core.txts.length) {
    const rest = Object.keys(PARTS).filter((p) => p !== 'core');
    const answers = await Promise.all(rest.map((p) => txtLookup(recordName(p, domain), fetchImpl)));
    rest.forEach((p, i) => { found[p] = answers[i].txts; ttls.push(answers[i].ttl); dnssec &&= answers[i].ad; });
  }
  const known = ttls.filter((t) => t !== undefined);
  return { ...assembleSection(domain, found, now), ttl: known.length ? Math.min(...known) : DEFAULT_TTL, dnssec };
}

/** Read a response body, giving up past `max` bytes. */
async function readCapped(res, max) {
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).subarray(0, max + 1);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

const IMAGES = {
  button: { max: BUTTON_MAX_BYTES, check: checkButtonImage },
  banner: { max: BANNER_MAX_BYTES, check: checkBannerImage },
};

/**
 * Fetch a Section's button or banner the way a hub must (TIMDA-1 §6.1): no redirects,
 * a size cap, then check the bytes. Returns { ok: true, type, width, height, bytes }
 * or { ok: false, error }.
 */
export async function fetchImage(what, url, { fetchImpl = fetch } = {}) {
  const { max, check } = IMAGES[what];
  try {
    const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { accept: 'image/png, image/gif' } });
    if (res.status !== 200) return { ok: false, error: `fetching the ${what} returned HTTP ${res.status}` };
    const bytes = await readCapped(res, max);
    if (!bytes || bytes.length > max) return { ok: false, error: `the ${what} is over ${max} bytes` };
    const c = check(bytes);
    return c.ok ? { ...c, bytes } : c;
  } catch (e) {
    return { ok: false, error: `fetching the ${what} failed: ${e.message}` };
  }
}

/**
 * GOOD / WARN / CRIT checks for a looked-up (or planned) Section. `images` maps
 * 'button' / 'banner' to fetchImage() results; leave it out when nothing was fetched.
 * DNSSEC is reported only when the result carries `dnssec` (a live lookup).
 */
export function sectionChecks({ status, section, errors = [], warnings = [], dnssec }, { images = {} } = {}) {
  const out = [];
  const add = (level, text) => out.push([level, text]);
  if (status === 'none') add('CRIT', 'no _timda core record: this site is not part of the station');
  else if (status === 'expired') add('CRIT', `${errors[0]}: delisted, as if the records were gone`);
  else if (status === 'unsupported' || status === 'invalid' || status === 'error') errors.forEach((e) => add('CRIT', e));
  if (section && status !== 'invalid' && status !== 'unsupported') add('GOOD', `core record valid (status: ${section.status})`);
  if (section?.key?.length) {
    const algs = [...new Set(section.key.map((k) => k.split(':')[0]))].join(', ');
    add('GOOD', `${section.key.length} key${section.key.length > 1 ? 's' : ''}: ${algs}`);
  }
  const links = section ? LINKS.filter((p) => section[p]) : [];
  if (links.length) add('GOOD', `${links.join(', ')}: valid link${links.length > 1 ? 's' : ''}`);
  if (section && !section.airlock) add('GOOD', 'no airlock record: the hub will use the homepage');
  if (section?.inbox) add('GOOD', `inbox: held at ${section.inbox.hub}, ${section.inbox.age ? 'encrypted to an age key' : 'not encrypted (the hub can read messages)'}`);
  for (const what of ['button', 'banner']) {
    const img = images[what];
    if (!img) continue;
    if (img.ok) add('GOOD', `${what}: ${img.width}x${img.height} ${img.type.slice(6).toUpperCase()}${what === 'banner' && section?.caption ? ', with a caption' : ''}`);
    else add('WARN', `${img.error}; hubs won't show it`);
  }
  warnings.forEach((w) => add('WARN', w));
  if (section && dnssec === true) add('GOOD', 'DNSSEC validated');
  else if (section && dnssec === false) add('WARN', 'DNSSEC not validated (optional, recommended)');
  return out;
}

// ---- SSH interop (TIMDA-2) -------------------------------------------------

function sshString(bytes) {
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);
  return out;
}

/** "ed25519:<b64>" or "sk-ed25519:<b64>" -> an OpenSSH public key line. */
export function sshPublicKey(keySpec) {
  const i = keySpec.indexOf(':');
  const alg = keySpec.slice(0, i);
  const pk = Uint8Array.from(atob(keySpec.slice(i + 1)), (c) => c.charCodeAt(0));
  const enc = new TextEncoder();
  const type = alg === 'ed25519' ? 'ssh-ed25519' : alg === 'sk-ed25519' ? 'sk-ssh-ed25519@openssh.com' : null;
  if (!type || pk.length !== 32) throw new Error(`not an SSH-compatible key: ${keySpec}`);
  const parts = [sshString(enc.encode(type)), sshString(pk)];
  if (alg === 'sk-ed25519') parts.push(sshString(enc.encode('ssh:')));
  const blob = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { blob.set(p, o); o += p.length; }
  return `${type} ${btoa(String.fromCharCode(...blob))}`;
}

/** allowed_signers lines for `ssh-keygen -Y verify`, one per key, principal = the domain. */
export function allowedSigners(domain, section) {
  return section.key.map((k) => `${domain} namespaces="timda" ${sshPublicKey(k)}`).join('\n') + '\n';
}

/** An OpenSSH public key line ("ssh-ed25519 AAAA… comment") -> "ed25519:<b64>" / "sk-ed25519:<b64>". */
export function recordKeyFromSshPublicKey(line) {
  const [type, b64] = line.trim().split(/\s+/);
  const blob = Uint8Array.from(atob(b64 ?? ''), (c) => c.charCodeAt(0));
  const view = new DataView(blob.buffer);
  const fields = [];
  for (let o = 0; o < blob.length;) {
    if (o + 4 > blob.length) throw new Error('truncated SSH public key');
    const n = view.getUint32(o);
    if (o + 4 + n > blob.length) throw new Error('truncated SSH public key');
    fields.push(blob.subarray(o + 4, o + 4 + n));
    o += 4 + n;
  }
  const dec = new TextDecoder();
  const inner = fields.length ? dec.decode(fields[0]) : '';
  if (inner !== type) throw new Error('key type does not match the key data');
  const pk = fields[1];
  if (!pk || pk.length !== 32) throw new Error('not a 32-byte Ed25519 key');
  const b = btoa(String.fromCharCode(...pk));
  if (type === 'ssh-ed25519' && fields.length === 2) return `ed25519:${b}`;
  if (type === 'sk-ssh-ed25519@openssh.com' && fields.length === 3) {
    if (dec.decode(fields[2]) !== 'ssh:') throw new Error('hardware key uses a non-default FIDO application; TIMDA requires "ssh:"');
    return `sk-ed25519:${b}`;
  }
  throw new Error(`unsupported key type: ${type} (use ed25519 or ed25519-sk)`);
}
