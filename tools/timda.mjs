#!/usr/bin/env node
// timda: look up, plan and check TIMDA records, and talk to hubs: dock, the Board, and
// the Wormhole Post. One command, a subcommand per job.
//
//   timda finger <domain>                         look a Section up, live, and check it
//   timda key <file.pub>                          the value for a _key._timda record
//   timda plan <domain> --name <name> --key <file.pub|value> [fields] [--format F]
//   timda plan --from section.toml [fields]       the same, from a settings file
//                                                 every record to publish, checked
//   timda init <domain>                           a starter section.toml
//   timda check <zonefile> <domain>               check records before publishing
//   timda signers <domain> [--zone <zonefile>]    an allowed_signers file for ssh-keygen
//   timda dock                                    send a signed dock request
//   timda mail [send <to> | delete <id…|all>]     collect, send and clear mail
//   timda board agenda | approve|delist|reinstate <section>   the hub's own motions
//
// The hub commands read section.toml (this folder's, or --from, or $TIMDA_SECTION):
// your domain, the key to sign with, your age identity. Signing runs ssh-keygen, so a
// key in an agent, a password manager or a hardware key works as it does for ssh.
//
// Run from this repo: node tools/timda.mjs …, npm run timda -- …, or `npm link` once
// for a `timda` command. Exit code: 0 good, 1 records not valid or the hub said no,
// 2 usage error.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGE_RE, HOST_RE, LINKS, allowedSigners, assembleSection, fetchImage, lookupSection, parseZone,
  planRecords, recordKeyFromSshPublicKey, renderPlan, sectionChecks, sshPublicKey,
} from './timda1.mjs';
import { parse as parseToml } from './vendor/smol-toml/index.js';
import { makeStatement, seal, signStatement, statementBody, submit, unseal, verifyMail } from './client.mjs';

export class Usage extends Error {}

const USAGE = `usage: timda <command> …

  finger <domain>                        look a Section up, live, and check it
  key <file.pub>                         print the value for a _key._timda record
  init <domain>                          print a starter section.toml
  plan <domain> --name <name> --key <file.pub|ed25519:…> [--key …]
       [--status open|closed|pending] [--concept TEXT] [--type section|place|hub]
       [--expires YYYY-MM-DD] [--auth passkey,pubkey,none]
       [--airlock URL] [--charter URL] [--setting URL] [--button URL]
       [--banner URL [--caption TEXT]] [--inbox HUB [--age age1…]] [--ttl 300]
       [--format zone|table|cloudflare|route53]
  plan --from section.toml [any of the above to override it]
                                         print every record to publish, checked
  check <zonefile> <domain>              check records before you publish them
  signers <domain> [--zone <zonefile>]   print an allowed_signers file (TIMDA-2)

  dock                                   ask your hub to dock your Section
  mail                                   collect your mail: checked, and opened if sealed
  mail send <domain> [--subject TEXT] [--file FILE]
                                         send a message (the text from --file, stdin, or
                                         $EDITOR); sealed with age if the recipient asks
  mail delete <id>… | all                clear mail you've read
  board agenda                           (hub operators) what's waiting, approved, delisted
  board approve|delist|reinstate <domain> [--reason TEXT]

  The hub commands take [--from section.toml] [--as DOMAIN] [--sign-with KEY.pub]
  [--via URL], and otherwise read ./section.toml, or $TIMDA_SECTION.`;

// ---- output ---------------------------------------------------------------------

// Colours only on a terminal, and never with NO_COLOR set (https://no-color.org/).
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const rgb = (c, text) => (COLOR ? `\x1b[38;2;${c.join(';')}m${text}\x1b[0m` : text);
const bold = (text) => (COLOR ? `\x1b[1m${text}\x1b[22m` : text);
// Section status colours (concepts/look.md): open cyan, closed amber, pending grey.
const STATUS_COLORS = { open: [132, 222, 228], closed: [226, 122, 78], pending: [117, 144, 193] };
const paint = (status) => (STATUS_COLORS[status] ? rgb(STATUS_COLORS[status], status) : status);
// Check levels: GOOD green, WARN amber, CRIT red.
const LEVELS = { GOOD: [80, 200, 120], WARN: [240, 180, 60], CRIT: [230, 70, 70] };
const tag = (level) => bold(rgb(LEVELS[level], level));
const CYAN = [132, 222, 228];
const AMBER = [226, 122, 78];
const DIM = [117, 144, 193];
// A bang path, the old way: section72.net!timda.space!section76.net
const bang = (...hops) => hops.filter((h, i) => h !== hops[i - 1]).join(rgb(AMBER, '!'));

/** A Section's records, then its checks, finger-style. */
export function render(label, result, images = {}) {
  const { status, section } = result;
  const lines = [`[${label}]`];
  if (section) {
    const row = (a, b = '') => lines.push(b ? a.padEnd(42) + b : a);
    row(`Designation: ${section.name}`, `Type: ${section.type}`);
    const statusCell = `Status: ${section.status}`; // pad by the visible text, not the colour codes
    lines.push(`Status: ${paint(section.status)}${section.auth?.length ? ' '.repeat(Math.max(1, 42 - statusCell.length)) + `Auth: ${section.auth.join(', ')}` : ''}`);
    if (section.expires) row(`Expires: ${section.expires}`);
    for (const k of section.key) row(`Key: ${k}`);
    for (const k of section.key) row(`SSH: ${sshPublicKey(k)}`);
    for (const part of LINKS) if (section[part]) row(`${part[0].toUpperCase()}${part.slice(1)}: ${section[part]}`);
    if (section.caption) row(`Caption: ${section.caption}`);
    if (section.inbox) row(`Inbox: ${section.inbox.hub}!${label}`, section.inbox.age ? 'Encrypted: age' : 'Encrypted: no');
    lines.push(...(section.concept ? ['Plan:', `  ${section.concept}`] : ['No Plan.']));
  } else if (status === 'none') {
    lines.push('No TIMDA records.');
  }
  lines.push('', 'Checks:', ...sectionChecks(result, { images }).map(([level, text]) => `  ${tag(level)}  ${text}`));
  return lines.join('\n');
}

// ---- arguments ------------------------------------------------------------------

function domainArg(s) {
  const d = (s ?? '').toLowerCase().replace(/\.$/, '');
  if (!HOST_RE.test(d)) throw new Usage(s ? `not a domain name: ${s}` : 'a domain is needed');
  return d;
}

/** Parse `argv` for one subcommand: `allowed` maps flag -> 'one' | 'many'. */
function parseArgs(argv, allowed, positional, maxPositional = positional) {
  const opts = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const name = a.slice(2);
    if (!(name in allowed)) throw new Usage(`unknown option ${a} for this command`);
    const val = argv[++i];
    if (val === undefined || val.startsWith('--')) throw new Usage(`${a} needs a value`);
    if (allowed[name] === 'many') (opts[name] ??= []).push(val);
    else if (name in opts) throw new Usage(`${a} given twice`);
    else opts[name] = val;
  }
  if (pos.length < positional || pos.length > maxPositional) {
    const want = positional === maxPositional ? `${positional}` : `${positional} to ${maxPositional}`;
    throw new Usage(`expected ${want} argument${maxPositional === 1 ? '' : 's'}, got ${pos.length}`);
  }
  return { opts, pos };
}

/** A key: a record value as-is, or a path to a .pub file (~ allowed; relative to `base`). */
function keyValue(k, base = '.') {
  if (/^(sk-)?ed25519:/.test(k)) return k;
  const path = k.startsWith('~/') ? resolve(homedir(), k.slice(2)) : resolve(base, k);
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { throw new Usage(`key ${k}: not a key value (ed25519:…) or a readable .pub file`); }
  return recordKeyFromSshPublicKey(text);
}

const zoneResult = (file, domain) => {
  const z = parseZone(readFileSync(file, 'utf8'), domain);
  const result = assembleSection(domain, z.found);
  result.warnings.unshift(...z.warnings);
  return result;
};

// ---- commands -------------------------------------------------------------------

// ---- section.toml -------------------------------------------------------------------

const FILE_TOP = { domain: 'string', name: 'string', status: 'string', type: 'string', concept: 'string', expires: 'date', auth: 'strings', keys: 'strings', ttl: 'integer', links: 'table', inbox: 'table', cli: 'table' };
const FILE_INBOX = { hub: 'string', age: 'string' };
const FILE_CLI = { sign_with: 'string', age_identity: 'string', ssh_keygen: 'string', age: 'string', hub_url: 'string' };
const FILE_LINKS = { airlock: 'string', charter: 'string', setting: 'string', button: 'string', banner: 'string', caption: 'string' };

/** Read a section.toml into plan options, strictly: unknown keys and wrong types are errors. */
export function readSectionFile(file) {
  let doc;
  try { doc = parseToml(readFileSync(file, 'utf8')); } catch (e) { throw new Usage(`${file}: ${e.code === 'ENOENT' ? 'no such file' : e.message.split('\n')[0]}`); }
  const check = (obj, schema, where) => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const kind = schema[k];
      if (!kind) throw new Usage(`${file}: unknown setting ${where}${k} (expected one of: ${Object.keys(schema).join(', ')})`);
      const bad = () => new Usage(`${file}: ${where}${k} should be ${{ string: 'a string', strings: 'a list of strings', integer: 'a whole number', table: 'a [table]', date: 'a date like 2027-01-04' }[kind]}`);
      if (kind === 'string' && typeof v !== 'string') throw bad();
      if (kind === 'strings' && !(Array.isArray(v) && v.every((x) => typeof x === 'string'))) throw bad();
      if (kind === 'integer' && !Number.isInteger(v)) throw bad();
      if (kind === 'table' && (typeof v !== 'object' || v === null || Array.isArray(v) || v instanceof Date)) throw bad();
      if (kind === 'date' && !(typeof v === 'string' || v instanceof Date)) throw bad();
      out[k] = kind === 'date' && v instanceof Date ? v.toISOString().slice(0, 10) : v;
    }
    return out;
  };
  const top = check(doc, FILE_TOP, '');
  const links = top.links ? check(top.links, FILE_LINKS, 'links.') : {};
  const inbox = top.inbox ? check(top.inbox, FILE_INBOX, 'inbox.') : {};
  const cli = top.cli ? check(top.cli, FILE_CLI, 'cli.') : {};
  delete top.links;
  delete top.inbox;
  delete top.cli;
  return { ...top, ...links, ...(inbox.hub && { inbox: inbox.hub }), ...(inbox.age && { age: inbox.age }), cli, base: dirname(resolve(file)) };
}

const TEMPLATE = (domain) => `# TIMDA records for ${domain}. Make the records with:
#   timda plan --from section.toml               (add --format table|cloudflare|route53)
# Strings in "quotes". Lines starting # are comments.

domain  = "${domain}"
name    = "My Section"            # up to 48 characters
status  = "pending"               # pending while you set up; open to be linked; or closed
concept = "One line, in world"    # optional, up to 120 characters
keys    = ["~/.ssh/timda.pub"]    # .pub files (relative to this file, or ~/...) or ed25519:... values
ttl     = 300                     # seconds; the same on every record

[links]                           # all optional; all but setting must be on your own domain
# airlock = "https://${domain}/airlock"     # where visitors land (your homepage if left out)
# charter = "https://${domain}/charter"     # your rules
# setting = "https://${domain}/setting"     # your lore (may be anywhere)
# button  = "https://${domain}/88x31.png"   # an 88x31 PNG or GIF
# banner  = "https://${domain}/468x60.png"  # a 468x60 PNG or GIF, for the Lounge
# caption = "Shown with the banner"        # up to 140 characters

[inbox]                           # optional: take signed messages through a hub (TIMDA-3)
# hub = "timda.space"                       # the hub that holds your mail
# age = "age1..."                           # encrypt messages to you (age-keygen); else the hub can read them

[cli]                             # optional: for timda dock, mail and board
# sign_with    = "~/.ssh/timda.pub"         # the key to sign with (default: the first of keys)
# age_identity = "~/.age/section.txt"       # your age key file, to open sealed mail
# ssh_keygen   = "ssh-keygen"               # on WSL with a Windows agent (Bitwarden, 1Password):
#                                           #   "/mnt/c/Windows/System32/OpenSSH/ssh-keygen.exe"
# hub_url      = "https://timda.space"      # where your hub answers, if not https://<hub>
`;

const PLAN_FLAGS = {
  name: 'one', status: 'one', concept: 'one', type: 'one', expires: 'one', auth: 'one', key: 'many',
  airlock: 'one', charter: 'one', setting: 'one', button: 'one', banner: 'one', caption: 'one',
  inbox: 'one', age: 'one', ttl: 'one', format: 'one', from: 'one',
};
const FORMATS = ['zone', 'table', 'cloudflare', 'route53'];

// ---- talking to hubs ----------------------------------------------------------------

const HUB_FLAGS = { from: 'one', as: 'one', 'sign-with': 'one', via: 'one' };
const expand = (p, base) => (p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : resolve(base, p));

/** Who's speaking, and how: from section.toml (or --from / $TIMDA_SECTION), and flags. */
function identity(opts) {
  const file = opts.from ?? process.env.TIMDA_SECTION ?? (existsSync('section.toml') ? 'section.toml' : undefined);
  const s = file ? readSectionFile(file) : { cli: {}, base: '.' };
  const domain = opts.as ? domainArg(opts.as) : s.domain;
  if (!domain) throw new Usage('who are you? Run this in a folder with your section.toml, or give --from FILE or --as DOMAIN');
  const keyPath = opts['sign-with'] ?? s.cli.sign_with ?? s.keys?.find((k) => !/^(sk-)?ed25519:/.test(k));
  if (!keyPath) throw new Usage('which key signs? Set sign_with in [cli], or give --sign-with KEY.pub');
  const key = opts['sign-with'] ? expand(keyPath, '.') : expand(keyPath, s.base);
  const hub = s.inbox ?? 'timda.space';
  return {
    domain, key, hub,
    hubUrl: (opts.via ?? s.cli.hub_url ?? `https://${hub}`).replace(/\/+$/, ''),
    sshKeygen: s.cli.ssh_keygen ?? 'ssh-keygen',
    age: s.cli.age ?? 'age',
    ageIdentity: s.cli.age_identity ? expand(s.cli.age_identity, s.base) : undefined,
    explicitVia: Boolean(opts.via),
  };
}

/** Make, sign and hand over a statement; the hub's JSON reply. */
async function send(me, endpoint, type, fields, hubUrl = me.hubUrl) {
  const text = makeStatement(type, { from: me.domain, ...fields });
  const signature = await signStatement(text, { key: me.key, sshKeygen: me.sshKeygen });
  return submit(`${hubUrl}${endpoint}`, text, signature);
}

const label = (name, value) => `${rgb(DIM, `${name}:`.padEnd(10))}${value}`;

/** One collected message, finger-style. */
async function renderMail(m, me, hub) {
  const v = await verifyMail(m);
  const lines = [
    rgb(DIM, '─'.repeat(64)),
    label('Path', `${bang(m.from, hub, m.to)}   ${v.ok ? rgb(CYAN, `✓ signed by ${m.from}`) : rgb(LEVELS.CRIT, `✗ ${v.error}`)}`),
    label('Subject', m.subject ? bold(m.subject) : rgb(DIM, '(none)')),
    label('Received', `${m.received.replace('T', ' ').slice(0, 16)} UTC   ${rgb(DIM, `ID ${m.id}`)}`),
    label('Envelope', m.encrypted ? rgb(CYAN, 'sealed (age)') : rgb(AMBER, 'open: the hub can read it')),
    '',
  ];
  let body = statementBody(m.statement);
  if (m.encrypted) {
    if (!me.ageIdentity) body = rgb(DIM, '(sealed: set age_identity in [cli] to open it here)\n');
    else {
      try { body = await unseal(body, me.ageIdentity, me.age); } catch (e) { body = rgb(LEVELS.CRIT, `(couldn't open it: ${e.message})\n`); }
    }
  }
  lines.push(...body.replace(/\n$/, '').split('\n').map((l) => `  ${l}`), '');
  return { text: lines.join('\n'), verified: v.ok };
}

/** Read the body for `mail send`: --file, piped stdin, or the user's editor. */
function messageBody(opts) {
  if (opts.file) {
    try { return readFileSync(opts.file, 'utf8'); } catch { throw new Usage(`--file ${opts.file}: can't read it`); }
  }
  if (!process.stdin.isTTY) return readFileSync(0, 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'timda-'));
  const file = join(dir, 'message.txt');
  writeFileSync(file, '');
  try {
    const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
    const r = spawnSync(editor, [file], { stdio: 'inherit', shell: true });
    if (r.status !== 0) throw new Usage(`${editor} exited with ${r.status}; nothing sent`);
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const COMMANDS = {
  async finger(argv, out) {
    const { pos } = parseArgs(argv, {}, 1);
    const domain = domainArg(pos[0]);
    const result = await lookupSection(domain);
    const images = {};
    for (const what of ['button', 'banner']) if (result.section?.[what]) images[what] = await fetchImage(what, result.section[what]);
    out.log(render(domain, result, images));
    return result.status === 'valid' ? 0 : 1;
  },

  async init(argv, out) {
    const { pos } = parseArgs(argv, {}, 1);
    out.write(TEMPLATE(domainArg(pos[0])));
    return 0;
  },

  async key(argv, out) {
    const { pos } = parseArgs(argv, {}, 1);
    out.log(keyValue(pos[0]));
    return 0;
  },

  async plan(argv, out) {
    const { opts: flags, pos } = parseArgs(argv, PLAN_FLAGS, 0, 1);
    // A settings file, if given, with any flags on the command line taking precedence.
    const file = flags.from ? readSectionFile(flags.from) : {};
    const opts = { ...file, ...flags, key: flags.key ?? file.keys, auth: flags.auth ?? file.auth?.join(','), ttl: flags.ttl ?? file.ttl };
    const keyBase = flags.key ? '.' : file.base ?? '.';
    const domain = domainArg(pos[0] ?? file.domain);
    if (!opts.name) throw new Usage(flags.from ? `${flags.from}: name is needed` : '--name is needed');
    if (!opts.key?.length) throw new Usage('at least one key is needed (--key, or keys in the file: a .pub file or an ed25519:… value)');
    if (opts.caption && !opts.banner) throw new Usage('a caption goes with a banner');
    if (opts.age && !opts.inbox) throw new Usage('an age key goes with an inbox (--inbox HUB)');
    if (opts.inbox && !HOST_RE.test(String(opts.inbox))) throw new Usage(`inbox hub ${opts.inbox}: not a domain name`);
    if (opts.age && !AGE_RE.test(String(opts.age))) throw new Usage('age key: expected an age X25519 public key (age1…, from age-keygen)');
    const format = opts.format ?? 'zone';
    if (!FORMATS.includes(format)) throw new Usage(`--format must be ${FORMATS.join(', ')}`);
    const plan = planRecords(domain, {
      name: opts.name, status: opts.status ?? 'pending', type: opts.type, concept: opts.concept, expires: opts.expires,
      auth: opts.auth ? String(opts.auth).split(',') : undefined, keys: opts.key.map((k) => keyValue(k, keyBase)),
      airlock: opts.airlock, charter: opts.charter, setting: opts.setting, button: opts.button,
      banner: opts.banner, caption: opts.caption, inbox: opts.inbox, age: opts.age, ttl: opts.ttl ? Number(opts.ttl) : undefined,
    });
    out.write(renderPlan(plan, format));
    // Check exactly what was planned, the way a reader will see it.
    const z = parseZone(renderPlan(plan, 'zone'), domain);
    const result = assembleSection(domain, z.found);
    result.warnings.unshift(...z.warnings);
    if (result.status !== 'valid' || result.warnings.length) out.error(render(domain, result));
    return result.status === 'valid' ? 0 : 1;
  },

  async check(argv, out) {
    const { pos } = parseArgs(argv, {}, 2);
    const domain = domainArg(pos[1]);
    const result = zoneResult(pos[0], domain);
    out.log(render(domain, result));
    return result.status === 'valid' ? 0 : 1;
  },

  async dock(argv, out) {
    const { opts } = parseArgs(argv, HUB_FLAGS, 0);
    const me = identity(opts);
    const r = await send(me, '/api/dock', 'dock-request', { hub: me.hub });
    if (!r.ok) { out.error(`${tag('CRIT')}  not docked: ${r.error}`); return 1; }
    const said = r.state === 'review'
      ? `${r.already ? 'still waiting' : 'docked, and waiting'} for review by the Board`
      : r.already ? 'already docked; its records were re-checked' : 'docked and listed';
    out.log(`${tag('GOOD')}  ${bold(r.name)} (${r.from}) at ${me.hub}: ${said}`);
    return 0;
  },

  async board(argv, out) {
    const [motion, ...rest] = argv;
    const MOTIONS = ['agenda', 'approve', 'delist', 'reinstate'];
    if (!MOTIONS.includes(motion)) throw new Usage(`board takes ${MOTIONS.join(', ')}`);
    const { opts, pos } = parseArgs(rest, { ...HUB_FLAGS, reason: 'one' }, motion === 'agenda' ? 0 : 1);
    if (opts.reason && motion !== 'delist') throw new Usage('--reason goes with delist');
    const me = identity(opts);
    const hubUrl = opts.via ?? (me.explicitVia ? me.hubUrl : undefined) ?? (me.hubUrl.endsWith(`//${me.hub}`) ? `https://${me.domain}` : me.hubUrl);
    const headers = motion === 'agenda' ? {} : { section: domainArg(pos[0]), reason: opts.reason };
    const r = await send(me, '/api/board', `board-${motion}`, { hub: me.domain, headers }, hubUrl);
    if (!r.ok) { out.error(`${tag('CRIT')}  motion failed: ${r.error}`); return 1; }
    if (motion === 'agenda') {
      const list = (name, ds, color) => out.log(label(name, ds.length ? ds.map((d) => rgb(color, d)).join(', ') : rgb(DIM, 'none')));
      out.log(bold(`The agenda at ${me.domain}`));
      list('Waiting', r.review, AMBER);
      list('Approved', r.approved, CYAN);
      list('Delisted', r.delisted, LEVELS.CRIT);
      return 0;
    }
    const did = { approve: 'approved and listed', delist: 'delisted, everywhere, at once', reinstate: 'reinstated and listed' }[motion];
    out.log(`${tag('GOOD')}  Resolution carried: ${r.section} is ${did}.`);
    return 0;
  },

  async mail(argv, out) {
    const [sub, ...rest] = argv[0] && !argv[0].startsWith('--') ? argv : [undefined, ...argv];
    if (sub === 'send') {
      const { opts, pos } = parseArgs(rest, { ...HUB_FLAGS, subject: 'one', file: 'one' }, 1);
      const me = identity(opts);
      const to = domainArg(pos[0]);
      // Where the recipient takes mail, and how, from its own records.
      const r = await lookupSection(to);
      if (r.status !== 'valid') { out.error(`${tag('CRIT')}  ${to} has no valid TIMDA records`); return 1; }
      const inbox = r.section.inbox;
      if (!inbox) { out.error(`${tag('CRIT')}  ${to} has no inbox (no _inbox._timda record)`); return 1; }
      let body = messageBody(opts);
      if (!body.trim()) { out.error('Nothing to send.'); return 1; }
      const headers = { to, subject: opts.subject };
      if (inbox.age) { body = await seal(body, inbox.age, me.age); headers.encrypted = 'age'; }
      const hubUrl = me.explicitVia || inbox.hub === me.hub ? me.hubUrl : `https://${inbox.hub}`;
      const res = await send(me, '/api/mail', 'message', { hub: inbox.hub, headers, body }, hubUrl);
      if (!res.ok) { out.error(`${tag('CRIT')}  not sent: ${res.error}`); return 1; }
      out.log(`${tag('GOOD')}  Sent ${bang(me.domain, inbox.hub, to)}, message ${res.id}, ${res.encrypted ? rgb(CYAN, 'sealed with age') : rgb(AMBER, 'open: the hub can read it')}`);
      return 0;
    }
    if (sub === 'delete') {
      const { opts, pos } = parseArgs(rest, HUB_FLAGS, 1, 100);
      const me = identity(opts);
      const ids = pos.join(',').split(',').map((x) => x.trim()).filter(Boolean);
      const res = await send(me, '/api/mail', 'inbox-delete', { hub: me.hub, headers: { delete: ids.join(', ') } });
      if (!res.ok) { out.error(`${tag('CRIT')}  ${res.error}`); return 1; }
      out.log(`${tag('GOOD')}  Deleted ${res.deleted.length}; ${res.left} left.${res.missing.length ? ` Not found: ${res.missing.join(', ')}.` : ''}`);
      return 0;
    }
    if (sub !== undefined) throw new Usage(`mail takes send or delete, or nothing to collect (not ${sub})`);
    const { opts } = parseArgs(rest, HUB_FLAGS, 0);
    const me = identity(opts);
    const res = await send(me, '/api/mail', 'inbox', { hub: me.hub });
    if (!res.ok) { out.error(`${tag('CRIT')}  ${res.error}`); return 1; }
    if (!res.mail.length) { out.log(`No mail for ${me.domain}.`); return 0; }
    out.log(bold(`${res.mail.length} message${res.mail.length === 1 ? '' : 's'} for ${me.domain}`) + rgb(DIM, `, oldest first; kept 30 days from arrival`));
    let allGood = true;
    for (const m of res.mail) {
      const { text, verified } = await renderMail(m, me, me.hub);
      allGood &&= verified;
      out.log(text);
    }
    return allGood ? 0 : 1;
  },

  async signers(argv, out) {
    const { opts, pos } = parseArgs(argv, { zone: 'one' }, 1);
    const domain = domainArg(pos[0]);
    const result = opts.zone ? zoneResult(opts.zone, domain) : await lookupSection(domain);
    if (result.status !== 'valid') { out.error(render(domain, result)); return 1; }
    out.write(allowedSigners(domain, result.section));
    return 0;
  },
};

/** Run one command line. Returns the exit code; output goes through `out`. */
export async function run(argv, out = { log: console.log, error: console.error, write: (s) => process.stdout.write(s) }) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { out.log(USAGE); return cmd ? 0 : 2; }
  try {
    if (!Object.hasOwn(COMMANDS, cmd)) throw new Usage(`unknown command: ${cmd}`);
    return await COMMANDS[cmd](rest, out);
  } catch (err) {
    if (err instanceof Usage) { out.error(`timda ${cmd}: ${err.message}\n\n${USAGE}`); return 2; }
    out.error(`timda ${cmd}: ${err.message}`);
    return 1;
  }
}

// Run when executed (directly, or through an `npm link` symlink), not when imported.
const invoked = (() => { try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (invoked) run(process.argv.slice(2)).then((code) => process.exit(code));
