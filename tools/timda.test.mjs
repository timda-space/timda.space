import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './timda.mjs';
import { translate } from './finger.mjs';
import { verifySshsig } from './sshsig.mjs';
import { recordKeyFromSshPublicKey } from './timda1.mjs';

const K1 = 'ed25519:gRfC33kq8uaLHoEvSy5bcmJSP8M64BM8nn7g2atWtkY=';
const dir = mkdtempSync(join(tmpdir(), 'timda-cli-'));

/** Run a command line, capturing output. */
async function cli(...argv) {
  const o = { out: '', err: '' };
  const code = await run(argv, { log: (s) => { o.out += `${s}\n`; }, error: (s) => { o.err += `${s}\n`; }, write: (s) => { o.out += s; } });
  return { code, ...o };
}

let haveSshKeygen = true;
try { execFileSync('ssh-keygen', ['-?'], { stdio: 'ignore' }); } catch (e) { haveSshKeygen = e.code !== 'ENOENT'; }

test('key: a .pub file becomes a record value; a value passes through', { skip: !haveSshKeygen && 'ssh-keygen not installed' }, async () => {
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', '', '-f', join(dir, 'k')]);
  const r = await cli('key', join(dir, 'k.pub'));
  assert.equal(r.code, 0);
  assert.match(r.out, /^ed25519:[A-Za-z0-9+/]{43}=\n$/);
  assert.equal((await cli('key', K1)).out, `${K1}\n`);
  assert.equal((await cli('key', join(dir, 'missing.pub'))).code, 2);
});

test('plan: every record, in any format, checked; mistakes are usage errors', async () => {
  const zone = await cli('plan', 'section72.net', '--name', 'Section 72', '--status', 'open', '--key', K1, '--banner', 'https://section72.net/468x60.png', '--caption', 'Hi; there');
  assert.equal(zone.code, 0, zone.err);
  assert.match(zone.out, /^_timda\.section72\.net\. +300 IN TXT "v=TIMDA1; name=Section 72; status=open"$/m);
  assert.match(zone.out, /caption=Hi%3B there"$/m);
  assert.equal(zone.err, '');
  for (const f of ['table', 'cloudflare', 'route53']) {
    const r = await cli('plan', 'section72.net', '--name', 'S', '--key', K1, '--format', f);
    assert.equal(r.code, 0, f);
  }
  assert.match((await cli('plan', 'section72.net', '--name', 'S', '--key', K1)).out, /status=pending/); // pending until you say open
  assert.match((await cli('plan', 'section72.net', '--name', 'S', '--key', K1, '--inbox', 'timda.space')).out, /^_inbox\._timda\.section72\.net\. +300 IN TXT "v=TIMDA1; hub=timda\.space"$/m);

  for (const [argv, msg] of [
    [['plan', 'section72.net', '--key', K1], /--name is needed/],
    [['plan', 'section72.net', '--name', 'S'], /at least one key is needed/],
    [['plan', 'section72.net', '--name', 'S', '--key', K1, '--caption', 'x'], /a caption goes with a banner/],
    [['plan', 'section72.net', '--name', 'S', '--key', K1, '--format', 'yaml'], /--format must be/],
    [['plan', 'section72.net', '--name', 'S', '--key-from', 'x.pub'], /unknown option --key-from/],
    [['plan', 'not a domain', '--name', 'S', '--key', K1], /not a domain name/],
    [['plan', 'section72.net', '--name', 'S', '--key', K1, '--age', 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p'], /an age key goes with an inbox/],
    [['plan', 'section72.net', '--name', 'S', '--key', K1, '--inbox', 'timda.space', '--age', 'age1nope'], /age key: expected/],
    [['nope'], /unknown command: nope/],
  ]) {
    const r = await cli(...argv);
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.err, msg);
  }
  // valid syntax, invalid records: exit 1 with the checks on stderr
  const bad = await cli('plan', 'section72.net', '--name', 'x'.repeat(60), '--key', K1);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /CRIT/);
});

test('check and signers work from a zone file', async () => {
  const good = join(dir, 'good.zone');
  writeFileSync(good, (await cli('plan', 'section72.net', '--name', 'Section 72', '--status', 'open', '--key', K1)).out);
  const c = await cli('check', good, 'section72.net');
  assert.equal(c.code, 0);
  assert.match(c.out, /Designation: Section 72/);
  assert.match(c.out, /GOOD  core record valid \(status: open\)/);
  assert.doesNotMatch(c.out, /DNSSEC/); // a file can't say
  const s = await cli('signers', 'section72.net', '--zone', good);
  assert.equal(s.code, 0);
  assert.match(s.out, /^section72\.net namespaces="timda" ssh-ed25519 AAAA/);

  const bad = join(dir, 'bad.zone');
  writeFileSync(bad, '_timda.section72.net. 300 IN TXT "v=TIMDA1; name=X; status=open"\n');
  const b = await cli('check', bad, 'section72.net');
  assert.equal(b.code, 1);
  assert.match(b.out, /CRIT/);
  assert.equal((await cli('signers', 'section72.net', '--zone', bad)).code, 1);
});

test('finger looks a domain up live, with its button and DNSSEC', async () => {
  const zones = {
    _timda: ['v=TIMDA1; name=Section 72; status=open; concept=The 90s in the future'],
    _key: [`v=TIMDA1; key=${K1}`],
    _button: ['v=TIMDA1; url=https://section72.net/88x31.png'],
  };
  const png = new Uint8Array(64);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(png.buffer).setUint32(16, 88); new DataView(png.buffer).setUint32(20, 31);
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === 'https://section72.net/88x31.png') return new Response(png);
    const name = new URL(url).searchParams.get('name');
    const first = name.split('.')[0];
    const recs = name.startsWith('_timda.') ? zones._timda : zones[first] ?? [];
    return new Response(JSON.stringify({ Status: 0, AD: true, Answer: recs.map((d) => ({ type: 16, TTL: 300, data: `"${d}"` })) }));
  };
  try {
    const r = await cli('finger', 'Section72.NET');
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^\[section72\.net\]/);
    assert.match(r.out, /Plan:\n  The 90s in the future/);
    assert.match(r.out, /SSH: ssh-ed25519 AAAA/);
    assert.match(r.out, /GOOD  button: 88x31 PNG/);
    assert.match(r.out, /GOOD  DNSSEC validated/);
  } finally {
    globalThis.fetch = real;
  }
});

test('finger.mjs translates the old flags into timda commands', () => {
  assert.deepEqual(translate(['section72.net']), ['finger', 'section72.net']);
  assert.deepEqual(translate(['--key-from', 'k.pub']), ['key', 'k.pub']);
  assert.deepEqual(translate(['--plan', 'section72.net', '--name', 'S', '--key-from', 'k.pub', '--key', K1]),
    ['plan', 'section72.net', '--name', 'S', '--key', 'k.pub', '--key', K1]);
  assert.deepEqual(translate(['--check', 'z.zone', 'section72.net']), ['check', 'z.zone', 'section72.net']);
  assert.deepEqual(translate(['--allowed-signers', 'section72.net']), ['signers', 'section72.net']);
  assert.deepEqual(translate(['--allowed-signers', '--check', 'z.zone', 'section72.net']), ['signers', 'section72.net', '--zone', 'z.zone']);
});

test('init writes a starter section.toml, and plan --from reads it', async () => {
  const init = await cli('init', 'section76.net');
  assert.equal(init.code, 0);
  assert.match(init.out, /^domain  = "section76\.net"$/m);
  const file = join(dir, 'section.toml');
  // the starter, filled in: a key value, a link, a banner and caption, and a date
  writeFileSync(file, init.out
    .replace('name    = "My Section"', 'name    = "Section 76"')
    .replace('["~/.ssh/timda.pub"]', `["${K1}"]`)
    .replace('# airlock = "https://section76.net/airlock"', 'airlock = "https://section76.net/airlock"')
    .replace('# banner  = "https://section76.net/468x60.png"', 'banner  = "https://section76.net/468x60.png"')
    .replace('# caption = "Shown with the banner"', 'caption = "Hello; there"') + 'expires = 2027-01-04\n'.replace(/^/, ''));
  // expires belongs at the top, before [links]: move it
  writeFileSync(file, readFileSync(file, 'utf8').replace('expires = 2027-01-04\n', '').replace('ttl     = 300', 'ttl     = 300\nexpires = 2027-01-04'));
  const r = await cli('plan', '--from', file);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^_timda\.section76\.net\. +300 IN TXT "v=TIMDA1; name=Section 76; status=pending; concept=One line, in world; expires=2027-01-04"$/m);
  assert.match(r.out, /_airlock\._timda\.section76\.net\..*url=https:\/\/section76\.net\/airlock"/);
  assert.match(r.out, /caption=Hello%3B there"/);
  // flags override the file; a positional domain overrides the file's
  const o = await cli('plan', 'section77.net', '--from', file, '--status', 'open', '--format', 'table');
  assert.equal(o.code, 0, o.err);
  assert.match(o.out, /Content: v=TIMDA1; name=Section 76; status=open/);
  assert.match(o.out, /in full: _timda\.section77\.net/);

  // keys may be .pub paths relative to the file
  if (haveSshKeygen) {
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', '', '-f', join(dir, 'rel')]);
    writeFileSync(join(dir, 'rel.toml'), `domain = "section76.net"\nname = "S"\nkeys = ["rel.pub"]\n`);
    const rel = await cli('plan', '--from', join(dir, 'rel.toml'));
    assert.equal(rel.code, 0, rel.err);
  }

  // strict: unknown settings, wrong types and broken TOML are usage errors that say why
  for (const [body, msg] of [
    ['domain = "section76.net"\nname = "S"\nkeys = ["' + K1 + '"]\ncolour = "teal"\n', /unknown setting colour/],
    ['domain = "section76.net"\nname = "S"\nkeys = "' + K1 + '"\n', /keys should be a list of strings/],
    ['domain = "section76.net"\nname = "S"\nkeys = ["' + K1 + '"]\n[links]\nhomepage = "https://x/"\n', /unknown setting links\.homepage/],
    ['domain = "section76.net"\nname = "S\n', /bad\.toml: /],
  ]) {
    writeFileSync(join(dir, 'bad.toml'), body);
    const b = await cli('plan', '--from', join(dir, 'bad.toml'));
    assert.equal(b.code, 2, body);
    assert.match(b.err, msg);
  }
  assert.match((await cli('plan', '--from', join(dir, 'nope.toml'))).err, /no such file/);
});


let haveAge = true;
try { execFileSync('age', ['--version'], { stdio: 'ignore' }); } catch { haveAge = false; }

test('dock, board and mail: signed with ssh-keygen, sealed with age, checked against DNS', { skip: (!haveSshKeygen && 'ssh-keygen not installed') || (!haveAge && 'age not installed') }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'timda-hub-'));
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', '', '-f', join(home, 'k')]);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', '', '-f', join(home, 'hub')]);
  execFileSync('age-keygen', ['-o', join(home, 'id.txt')], { stdio: 'ignore' });
  const recipient = execFileSync('age-keygen', ['-y', join(home, 'id.txt')]).toString().trim();
  const value = (f) => recordKeyFromSshPublicKey(readFileSync(join(home, f), 'utf8'));
  const zones = {
    'section72.net': { core: ['v=TIMDA1; name=Section 72; status=open'], key: [`v=TIMDA1; key=${value('k.pub')}`], inbox: [`v=TIMDA1; hub=timda.space; age=${recipient}`] },
    'section76.net': { core: ['v=TIMDA1; name=Section 76; status=open'], key: [`v=TIMDA1; key=${value('k.pub')}`], inbox: ['v=TIMDA1; hub=timda.space'] },
    'timda.space': { core: ['v=TIMDA1; name=TIMDA; status=open; type=hub'], key: [`v=TIMDA1; key=${value('hub.pub')}`] },
  };
  writeFileSync(join(home, 'section.toml'), `domain = "section72.net"\nname = "Section 72"\nkeys = ["k.pub"]\n[inbox]\nhub = "timda.space"\nage = "${recipient}"\n[cli]\nsign_with = "k"\nage_identity = "id.txt"\n`);
  writeFileSync(join(home, 'board.toml'), 'domain = "timda.space"\nname = "TIMDA"\nkeys = ["hub.pub"]\n');
  writeFileSync(join(home, 'body.txt'), 'Your station keeps answering our outside line.\n');

  // A stand-in hub: DNS over HTTPS, and the three endpoints, checking signatures for real.
  const held = [];
  const posted = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.hostname === 'cloudflare-dns.com') {
      const name = u.searchParams.get('name');
      const [, part, domain] = /^(?:_(key|inbox)\.)?_timda\.(.+)$/.exec(name) ?? [];
      const recs = zones[domain]?.[part ?? 'core'] ?? [];
      return new Response(JSON.stringify({ Status: 0, AD: true, Answer: recs.map((d) => ({ type: 16, TTL: 300, data: `"${d}"` })) }));
    }
    assert.equal(init.headers.accept, 'application/json');
    const text = await init.body.get('statement').text();
    const signature = await init.body.get('signature').text();
    const h = Object.fromEntries(text.split('\n\n')[0].split('\n').map((l) => l.split(/: (.*)/s).slice(0, 2)));
    posted.push({ url: `${u.origin}${u.pathname}`, h });
    const keys = zones[h.from].key.map((k) => k.slice('v=TIMDA1; key='.length));
    const sig = await verifySshsig({ message: new TextEncoder().encode(text), armored: signature, namespace: 'timda', allowedKeys: keys });
    const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    if (!sig.ok) return json({ ok: false, error: sig.error });
    if (u.pathname === '/api/dock') return json({ ok: true, type: h.type, from: h.from, state: 'review', already: false, name: 'Section 72', status: 'open' });
    if (u.pathname === '/api/board') return json(h.type === 'board-agenda' ? { ok: true, type: h.type, review: ['section72.net'], approved: [], delisted: [] } : { ok: true, type: h.type, section: h.section });
    if (h.type === 'message') {
      const m = { id: `${held.length}`.padStart(10, 'a'), from: h.from, to: h.to, subject: h.subject ?? '', received: '2026-11-23T01:00:00.000Z', encrypted: h.encrypted === 'age', statement: text, signature };
      held.push(m);
      return json({ ok: true, type: 'message', from: h.from, to: h.to, id: m.id, subject: m.subject, encrypted: m.encrypted, hub: 'timda.space' });
    }
    if (h.type === 'inbox') return json({ ok: true, type: 'inbox', from: h.from, mail: held.filter((m) => m.to === h.from) });
    const ids = h.delete === 'all' ? held.map((m) => m.id) : h.delete.split(', ');
    const gone = ids.filter((id) => held.some((m) => m.id === id));
    for (const id of gone) held.splice(held.findIndex((m) => m.id === id), 1);
    return json({ ok: true, type: 'inbox-delete', from: h.from, deleted: gone, missing: ids.filter((id) => !gone.includes(id)), left: held.length });
  };
  const from = join(home, 'section.toml');
  try {
    const dock = await cli('dock', '--from', from);
    assert.equal(dock.code, 0, dock.err);
    assert.match(dock.out, /GOOD  Section 72 \(section72\.net\) at timda\.space: docked, and waiting for review by the Board/);
    assert.deepEqual(posted.at(-1), { url: 'https://timda.space/api/dock', h: posted.at(-1).h });
    assert.equal(posted.at(-1).h.hub, 'timda.space');

    // the Board: signed by the hub's own key, sent to the hub's own domain
    const agenda = await cli('board', 'agenda', '--from', join(home, 'board.toml'), '--sign-with', join(home, 'hub'));
    assert.equal(agenda.code, 0, agenda.err);
    assert.match(agenda.out, /Waiting: +section72\.net/);
    const approve = await cli('board', 'approve', 'section72.net', '--from', join(home, 'board.toml'), '--sign-with', join(home, 'hub'));
    assert.match(approve.out, /Resolution carried: section72\.net is approved and listed/);
    assert.equal(posted.at(-1).h.section, 'section72.net');

    // to itself: its inbox asks for age, so the CLI seals it unasked
    const sealed = await cli('mail', 'send', 'section72.net', '--subject', 'The modem on bench 3', '--file', join(home, 'body.txt'), '--from', from);
    assert.equal(sealed.code, 0, sealed.err);
    assert.match(sealed.out, /Sent section72\.net!timda\.space!section72\.net, message a+0, sealed with age/);
    assert.equal(held[0].encrypted, true);
    assert.match(held[0].statement, /\nencrypted: age\n\n-----BEGIN AGE ENCRYPTED FILE-----/);
    // to a Section without an age key: sent open, and said so
    const open = await cli('mail', 'send', 'section76.net', '--file', join(home, 'body.txt'), '--from', from);
    assert.match(open.out, /message a+1, open: the hub can read it/);
    const inbox = await cli('mail', '--from', from);
    assert.equal(inbox.code, 0, inbox.err + inbox.out);
    assert.match(inbox.out, /^1 message for section72\.net/);
    assert.match(inbox.out, /Path: +section72\.net!timda\.space!section72\.net +✓ signed by section72\.net/);
    assert.match(inbox.out, /Subject: +The modem on bench 3\n/);
    assert.match(inbox.out, /Envelope: sealed \(age\)\n\n  Your station keeps answering our outside line\.\n/); // opened with the age identity

    // a hub that relabels mail (the open message to section76.net, handed to us) is caught
    held.push({ ...held[1], id: 'bbbbbbbbbb', to: 'section72.net' });
    const relabelled = await cli('mail', '--from', from);
    assert.equal(relabelled.code, 1);
    assert.match(relabelled.out, /✗ the statement doesn't match what the hub says it is[^]*Envelope: open: the hub can read it/);
    // and so is a forged one: the signature doesn't check out against DNS
    held[0].statement = held[0].statement.replace('bench 3', 'bench 4');
    assert.match((await cli('mail', '--from', from)).out, /✗ signature does not verify/);

    const del = await cli('mail', 'delete', 'aaaaaaaaa0', 'nope', '--from', from);
    assert.match(del.out, /Deleted 1; 2 left\. Not found: nope\./);
    assert.match((await cli('mail', 'delete', 'all', '--from', from)).out, /Deleted 2; 0 left/);
    assert.match((await cli('mail', '--from', from)).out, /^No mail for section72\.net\./);

    // usage: who's speaking has to be known
    assert.equal((await cli('mail', 'send', 'section76.net', '--file', join(home, 'body.txt'))).code, 2);
    assert.match((await cli('board', 'vote')).err, /board takes agenda, approve, delist, reinstate/);
  } finally {
    globalThis.fetch = real;
  }
});
