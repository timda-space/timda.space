import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  airlockUrl, allowedSigners, assembleSection, checkBannerImage, checkButtonImage, joinPresentationTxt, parseCore, parseKeyRecord,
  parseInboxRecord, parseLinkRecord, parseZone, planRecords, planZone, recordKeyFromSshPublicKey, renderPlan, sectionChecks, sshPublicKey,
} from './timda1.mjs';

const spec = readFileSync(new URL('../specs/0001-finger-record.md', import.meta.url), 'utf8');
const NOW = new Date('2026-11-22T12:00:00Z');

// Throwaway Ed25519 public keys (private halves discarded).
const K1 = 'ed25519:gRfC33kq8uaLHoEvSy5bcmJSP8M64BM8nn7g2atWtkY=';
const K2 = 'ed25519:CzvLzCJ8enh9Y3gnGjCNdguztAxT+MgDsjVDNkXxEwg=';
const CORE = 'v=TIMDA1; name=A; status=open';
const keyRec = (k) => `v=TIMDA1; key=${k}`;
const url = (u) => `v=TIMDA1; url=${u}`;
const section = (found, domain = 'section72.net') => assembleSection(domain, found, NOW);

// ---- spec examples ------------------------------------------------------------

test('every zone example in the spec assembles into a valid Section', () => {
  const blocks = [...spec.matchAll(/```zone\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.equal(blocks.length, 4);
  for (const block of blocks) {
    const domain = /^_timda\.(\S+?)\.\s/m.exec(block)[1];
    const z = parseZone(block, domain);
    assert.deepEqual(z.warnings, [], domain);
    const r = section(z.found, domain);
    assert.equal(r.status, 'valid', `${domain}: ${r.errors.join('; ')}`);
    assert.deepEqual(r.warnings, [], domain);
    for (const line of block.trim().split('\n')) {
      const content = joinPresentationTxt(line.slice(line.indexOf('"')));
      assert.ok(content.length <= 255, `over one string: ${line}`);
    }
  }
});

// ---- core record ----------------------------------------------------------------

test('core: parses all tags', () => {
  const r = parseCore('v=TIMDA1; name=Section 72; status=open; type=section; concept=Hi; expires=2027-01-04; auth=passkey,pubkey');
  assert.equal(r.status, 'valid');
  assert.deepEqual(r.core, {
    v: 'TIMDA1', name: 'Section 72', status: 'open', type: 'section', concept: 'Hi',
    expires: '2027-01-04T00:00:00.000Z', auth: ['passkey', 'pubkey'],
  });
});

test('core: type defaults to section; whitespace and one trailing semicolon are allowed', () => {
  const r = parseCore('  v = TIMDA1 ;name=Regus 12;  status=closed ;');
  assert.equal(r.status, 'valid');
  assert.equal(r.core.type, 'section');
  assert.equal(r.core.name, 'Regus 12');
});

test('core: percent-decoding, including UTF-8', () => {
  const r = parseCore('v=TIMDA1; name=Caf%C3%A9 9; status=open; concept=50%25 off%3B today');
  assert.equal(r.core.name, 'Café 9');
  assert.equal(r.core.concept, '50% off; today');
});

test('core: rejects raw %, invalid UTF-8 and raw non-ASCII', () => {
  assert.equal(parseCore('v=TIMDA1; name=100%; status=open').status, 'invalid');
  assert.equal(parseCore('v=TIMDA1; name=%C3; status=open').status, 'invalid');
  assert.equal(parseCore(joinPresentationTxt('"v=TIMDA1; name=Caf\\195\\169; status=open"')).status, 'invalid');
});

test('core: missing required tags, bad order, duplicates, empty tags', () => {
  assert.deepEqual(parseCore('v=TIMDA1; name=Section 72').errors, ['missing required tag: status']);
  assert.equal(parseCore('name=A; v=TIMDA1; status=open').status, 'invalid');
  assert.match(parseCore('v=TIMDA1; name=A; name=B; status=open').errors[0], /duplicate/);
  assert.equal(parseCore('v=TIMDA1;; name=A; status=open').status, 'invalid');
});

test('core: unknown status/type, bad expires and over-long values are invalid', () => {
  assert.equal(parseCore('v=TIMDA1; name=A; status=maybe').status, 'invalid');
  assert.equal(parseCore('v=TIMDA1; name=A; status=open; type=moon').status, 'invalid');
  assert.equal(parseCore('v=TIMDA1; name=A; status=open; expires=next tuesday').status, 'invalid');
  assert.equal(parseCore('v=TIMDA1; name=A; status=open; expires=2026-02-31').status, 'invalid');
  assert.equal(parseCore(`v=TIMDA1; name=${'%C3%A9'.repeat(48)}; status=open`).status, 'valid');
  assert.equal(parseCore(`v=TIMDA1; name=${'x'.repeat(49)}; status=open`).status, 'invalid');
});

test('core: future versions are unsupported, not invalid', () => {
  assert.equal(parseCore('v=TIMDA2; whatever=1').status, 'unsupported');
});

test('core: pieces that belong in their own records are flagged, not used', () => {
  const r = parseCore(`${CORE}; key=${K1}; charter=https://x/`);
  assert.equal(r.status, 'valid');
  assert.equal(r.core.key, undefined);
  assert.match(r.warnings.join('\n'), /key= doesn't belong in the core; publish it at _key\._timda/);
  assert.match(r.warnings.join('\n'), /charter= doesn't belong in the core; publish it at _charter\._timda/);
});

// ---- key records --------------------------------------------------------------

test('key records: ed25519 and sk-ed25519; malformed ones are skipped with a reason', () => {
  assert.deepEqual(parseKeyRecord(keyRec(K1)), { key: K1 });
  const sk = K2.replace('ed25519', 'sk-ed25519');
  assert.deepEqual(parseKeyRecord(keyRec(sk)), { key: sk });
  for (const bad of [
    'v=TIMDA1; key=gRfC33kq8uaLHoEvSy5bcmJSP8M64BM8nn7g2atWtkY=',      // no alg
    'v=TIMDA1; key=ed25519:gRfC33kq8uaLHoEvSy5bcmJSP8M64BM8nn7g2atWtkY', // no padding
    'v=TIMDA1; key=ed25519:gRfC33kq8uaLHoEvSy5bcmJSP8M64BM8nn7g2atWtkZ=', // non-canonical
    'v=TIMDA1; key=ed25519:AAAA',
    'v=TIMDA1; key=mlkem:abc',
    `v=TIMDA2; key=${K1}`,
    'v=TIMDA1',
  ]) assert.ok(parseKeyRecord(bad).warning, bad);
});

// ---- assembly and consistency (§2.1) --------------------------------------------

test('assembly: core + one key is a valid Section; airlock defaults to the domain root', () => {
  const r = section({ core: [CORE], key: [keyRec(K1)] });
  assert.equal(r.status, 'valid');
  assert.deepEqual(r.section.key, [K1]);
  assert.equal(airlockUrl('section72.net', r.section), 'https://section72.net/');
});

test('assembly: no core means no Section, whatever else exists', () => {
  assert.equal(section({ key: [keyRec(K1)], charter: [url('https://section72.net/c')] }).status, 'none');
  assert.equal(section({ core: ['google-site-verification=abc'] }).status, 'none');
});

test('assembly: a core without a usable key is invalid', () => {
  assert.equal(section({ core: [CORE] }).status, 'invalid');
  const r = section({ core: [CORE], key: ['v=TIMDA1; key=ed25519:AAAA', `v=TIMDA2; key=${K1}`] });
  assert.equal(r.status, 'invalid');
  assert.equal(r.warnings.length, 2);
});

test('assembly: two cores are invalid', () => {
  assert.equal(section({ core: [CORE, CORE], key: [keyRec(K1)] }).status, 'invalid');
});

test('assembly: many keys, bad ones skipped, duplicates once, capped at 8', () => {
  const r = section({ core: [CORE], key: [keyRec(K1), keyRec(K1), keyRec(K2), 'v=TIMDA1; key=mlkem:x'] });
  assert.equal(r.status, 'valid');
  assert.deepEqual(r.section.key, [K1, K2]);
  assert.equal(r.warnings.length, 1);

  const many = Array.from({ length: 10 }, (_, i) => keyRec(`ed25519:${Buffer.alloc(32, i + 1).toString('base64')}`));
  const capped = section({ core: [CORE], key: many });
  assert.equal(capped.section.key.length, 8);
  assert.match(capped.warnings.join('\n'), /only the first 8/);
});

test('assembly: links, same-domain rules, and duplicate link records', () => {
  const r = section({
    core: [CORE], key: [keyRec(K1)],
    airlock: [url('https://airlock.section72.net/')],
    charter: [url('https://section72.net/charter')],
    setting: [url('https://wiki.example/section-72')],
    button: [url('https://section72.net/88x31.png')],
  });
  assert.equal(r.status, 'valid');
  assert.equal(r.section.airlock, 'https://airlock.section72.net/');
  assert.equal(r.section.charter, 'https://section72.net/charter');
  assert.equal(r.section.setting, 'https://wiki.example/section-72'); // setting may be off-domain
  assert.equal(r.section.button, 'https://section72.net/88x31.png');
  assert.deepEqual(r.warnings, []);

  for (const bad of ['https://evil.example/', 'https://section72.net.evil.example/', 'https://notsection72.net/', 'http://section72.net/']) {
    for (const part of ['airlock', 'charter', 'button']) {
      const x = section({ core: [CORE], key: [keyRec(K1)], [part]: [url(bad)] });
      assert.equal(x.status, 'valid');
      assert.equal(x.section[part], undefined, `${part} ${bad}`);
      assert.equal(x.warnings.length, 1);
    }
  }
  const dup = section({ core: [CORE], key: [keyRec(K1)], charter: [url('https://section72.net/a'), url('https://section72.net/b')] });
  assert.equal(dup.section.charter, undefined);
  assert.match(dup.warnings[0], /2 records/);
  assert.ok(parseLinkRecord('setting', url('javascript:alert(1)'), 'section72.net').warning);
});

test('assembly: expires in the past means expired, in the future means valid', () => {
  assert.equal(section({ core: [`${CORE}; expires=2026-11-01`], key: [keyRec(K1)] }).status, 'expired');
  assert.equal(section({ core: [`${CORE}; expires=2026-11-22T13:00:00Z`], key: [keyRec(K1)] }).status, 'valid');
});

// ---- zone files -----------------------------------------------------------------

test('plan -> zone -> check round trip, with encoding and one TTL', () => {
  const zone = planZone('Section72.net.', {
    name: 'Café 72', status: 'open', concept: '50% off; today', keys: [K1, K2], expires: '2027-01-04',
    airlock: 'https://airlock.section72.net/', charter: 'https://section72.net/charter', setting: 'https://wiki.example/s72', ttl: 300,
  });
  assert.match(zone, /^_timda\.section72\.net\. +300 IN TXT "v=TIMDA1; name=Caf%C3%A9 72; status=open; concept=50%25 off%3B today; expires=2027-01-04"$/m);
  assert.equal((zone.match(/^_key\._timda\.section72\.net\./gm) ?? []).length, 2);
  const z = parseZone(zone, 'section72.net');
  assert.deepEqual(z.warnings, []);
  const r = section(z.found);
  assert.equal(r.status, 'valid');
  assert.equal(r.section.name, 'Café 72');
  assert.equal(r.section.concept, '50% off; today');
  assert.deepEqual(r.section.key, [K1, K2]);
});

test('check warns about mixed or long TTLs', () => {
  const z = parseZone(`_timda.a.example. 300 IN TXT "${CORE}"\n_key._timda.a.example. 86400 IN TXT "${keyRec(K1)}"\n`, 'a.example');
  assert.match(z.warnings.join('\n'), /different TTLs/);
  assert.match(z.warnings.join('\n'), /over an hour/);
});

test('joinPresentationTxt joins character-strings with no separator', () => {
  assert.equal(joinPresentationTxt('"v=TIMDA1; name=Sec" "tion 72; say=\\"hi\\""'), 'v=TIMDA1; name=Section 72; say="hi"');
});

// ---- TIMDA-2: SSH interop ---------------------------------------------------

// A throwaway key made with `ssh-keygen -t ed25519` (private half discarded).
const SSH_PUB = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIARFOFOU7pnCXLbor/X1iLm9xVrp8rdulfPXD01Gf2EK';
const SSH_RAW = 'BEU4U5TumcJctuiv9fWIub3FWunyt26V89cPTUZ/YQo=';

test('ed25519 key converts to the exact OpenSSH public key', () => {
  assert.equal(sshPublicKey(`ed25519:${SSH_RAW}`), SSH_PUB);
});

test('sk-ed25519 converts to sk-ssh-ed25519@openssh.com with application "ssh:"', () => {
  const [type, b64] = sshPublicKey(`sk-ed25519:${SSH_RAW}`).split(' ');
  assert.equal(type, 'sk-ssh-ed25519@openssh.com');
  const blob = Buffer.from(b64, 'base64');
  const fields = [];
  for (let o = 0; o < blob.length;) { const n = blob.readUInt32BE(o); fields.push(blob.subarray(o + 4, o + 4 + n)); o += 4 + n; }
  assert.equal(fields[0].toString(), 'sk-ssh-ed25519@openssh.com');
  assert.equal(fields[1].toString('base64'), SSH_RAW);
  assert.equal(fields[2].toString(), 'ssh:');
});

test('.pub file -> key value, for ed25519 and ed25519-sk', () => {
  assert.equal(recordKeyFromSshPublicKey(`${SSH_PUB} someone@somewhere\n`), `ed25519:${SSH_RAW}`);
  assert.equal(recordKeyFromSshPublicKey(`${sshPublicKey(`sk-ed25519:${SSH_RAW}`)} c`), `sk-ed25519:${SSH_RAW}`);
  assert.throws(() => recordKeyFromSshPublicKey('ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ== x'));
  assert.throws(() => recordKeyFromSshPublicKey(SSH_PUB.replace('ssh-ed25519', 'sk-ssh-ed25519@openssh.com')), /does not match/);
});

test('allowedSigners writes one line per key, principal = domain, namespace timda', () => {
  const r = section({ core: [CORE], key: [keyRec(`ed25519:${SSH_RAW}`), keyRec(`sk-ed25519:${SSH_RAW}`)] });
  const lines = allowedSigners('section72.net', r.section).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], `section72.net namespaces="timda" ${SSH_PUB}`);
  assert.match(lines[1], /^section72\.net namespaces="timda" sk-ssh-ed25519@openssh\.com /);
});

let haveSshKeygen = true;
try { execFileSync('ssh-keygen', ['-?'], { stdio: 'ignore' }); } catch (e) { haveSshKeygen = e.code !== 'ENOENT'; }

test('round trip: ssh-keygen signs, allowed_signers from the key records verifies', { skip: !haveSshKeygen && 'ssh-keygen not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'timda-'));
  const key = join(dir, 'k');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', '', '-f', key]);
  const recKey = recordKeyFromSshPublicKey(readFileSync(`${key}.pub`, 'utf8'));
  const r = section({ core: ['v=TIMDA1; name=Section 72; status=open'], key: [keyRec(recKey)] });
  assert.equal(r.status, 'valid');
  writeFileSync(join(dir, 'allowed_signers'), allowedSigners('section72.net', r.section));
  const msg = join(dir, 'dock.txt');
  writeFileSync(msg, 'timda-statement: 1\ntype: dock-request\nfrom: section72.net\nhub: timda.space\nissued: 2026-11-22T06:45:00Z\nnonce: abcdefabcdefabcdefabcd\n');
  execFileSync('ssh-keygen', ['-q', '-Y', 'sign', '-f', key, '-n', 'timda', msg]);
  const verify = (principal, ns, input) => execFileSync('ssh-keygen',
    ['-Y', 'verify', '-f', join(dir, 'allowed_signers'), '-I', principal, '-n', ns, '-s', `${msg}.sig`],
    { input, stdio: ['pipe', 'pipe', 'pipe'] });
  const body = readFileSync(msg);
  assert.match(verify('section72.net', 'timda', body).toString(), /Good "timda" signature for section72\.net/);
  assert.throws(() => verify('section72.net', 'git', body));                                      // wrong namespace
  assert.throws(() => verify('section76.net', 'timda', body));                                    // wrong domain
  assert.throws(() => verify('section72.net', 'timda', Buffer.concat([body, Buffer.from('x')]))); // tampered
});

test('pasting an OpenSSH public key gets a specific hint', () => {
  for (const bad of [
    `v=TIMDA1; key=ssh-ed25519:${SSH_PUB.split(' ')[1]}`,
    `v=TIMDA1; key=ssh-ed25519:${SSH_RAW}`,
    `v=TIMDA1; key=ed25519:${SSH_PUB.split(' ')[1]}`,
  ]) assert.match(parseKeyRecord(bad).warning, /OpenSSH public key.*timda key/, bad);
});

test('status=pending is valid (listed nowhere, but keys and signatures work)', () => {
  const r = section({ core: ['v=TIMDA1; name=A; status=pending'], key: [keyRec(K1)] });
  assert.equal(r.status, 'valid');
  assert.equal(r.section.status, 'pending');
});

test('button images: PNG or GIF, 88x31 or 176x62, at most 16 KiB; nothing else', () => {
  const png = (w, h, extra = 0) => {
    const b = new Uint8Array(33 + extra);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
    return b;
  };
  const gif = (w, h) => new Uint8Array([...'GIF89a'].map((c) => c.charCodeAt(0)).concat([w & 255, w >> 8, h & 255, h >> 8, 0, 0, 0]));
  assert.deepEqual(checkButtonImage(png(88, 31)), { ok: true, type: 'image/png', width: 88, height: 31 });
  assert.equal(checkButtonImage(png(176, 62)).ok, true);
  assert.deepEqual(checkButtonImage(gif(88, 31)), { ok: true, type: 'image/gif', width: 88, height: 31 });
  assert.match(checkButtonImage(png(88, 32)).error, /88x32/);
  assert.match(checkButtonImage(gif(100, 31)).error, /100x31/);
  assert.match(checkButtonImage(png(88, 31, 17000)).error, /limit/);
  assert.match(checkButtonImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')).error, /PNG or GIF/);
  assert.match(checkButtonImage(new Uint8Array([0xff, 0xd8, 0xff])).error, /PNG or GIF/); // JPEG
  // the real thing
  const real = readFileSync(new URL('../concepts/art/timda-88x31.png', import.meta.url));
  assert.deepEqual(checkButtonImage(real), { ok: true, type: 'image/png', width: 88, height: 31 });
});

test('plan includes the button record', () => {
  const zone = planZone('section72.net', { name: 'Section 72', status: 'open', keys: [K1], button: 'https://section72.net/88x31.png' });
  assert.match(zone, /^_button\._timda\.section72\.net\. +300 IN TXT "v=TIMDA1; url=https:\/\/section72\.net\/88x31\.png"$/m);
  const r = assembleSection('section72.net', parseZone(zone, 'section72.net').found, NOW);
  assert.equal(r.section.button, 'https://section72.net/88x31.png');
});

test('banner: a link record with an optional caption; only the banner takes one', () => {
  const r = section({ core: [CORE], key: [keyRec(K1)], banner: ['v=TIMDA1; url=https://section72.net/468x60.png; caption=The 90s, in the future. Now at 60%25 off!'] });
  assert.equal(r.status, 'valid');
  assert.equal(r.section.banner, 'https://section72.net/468x60.png');
  assert.equal(r.section.caption, 'The 90s, in the future. Now at 60% off!');
  const off = section({ core: [CORE], key: [keyRec(K1)], banner: [url('https://elsewhere.example/468x60.png')] });
  assert.equal(off.section.banner, undefined); // own domain only
  const long = section({ core: [CORE], key: [keyRec(K1)], banner: [`v=TIMDA1; url=https://section72.net/b.png; caption=${'x'.repeat(141)}`] });
  assert.equal(long.section.banner, 'https://section72.net/b.png');
  assert.equal(long.section.caption, undefined);
  assert.match(long.warnings[0], /over 140/);
  const wrong = section({ core: [CORE], key: [keyRec(K1)], charter: ['v=TIMDA1; url=https://section72.net/charter; caption=hi'] });
  assert.equal(wrong.section.charter, 'https://section72.net/charter');
  assert.equal(wrong.section.caption, undefined);
  const zone = planZone('section72.net', { name: 'Section 72', status: 'open', keys: [K1], banner: 'https://section72.net/468x60.png', caption: 'Now; with 60% more' });
  assert.match(zone, /_banner\._timda\.section72\.net\. +300 IN TXT "v=TIMDA1; url=https:\/\/section72\.net\/468x60\.png; caption=Now%3B with 60%25 more"/);
  assert.equal(assembleSection('section72.net', parseZone(zone, 'section72.net').found, NOW).section.caption, 'Now; with 60% more');
});

test('banner images: PNG or GIF, 468x60 or 936x120, at most 64 KiB', () => {
  const png = (w, h) => { const b = new Uint8Array(33); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };
  assert.equal(checkBannerImage(png(468, 60)).ok, true);
  assert.equal(checkBannerImage(png(936, 120)).ok, true);
  assert.match(checkBannerImage(png(88, 31)).error, /banner is 88x31; it must be 468x60/);
  assert.match(checkButtonImage(png(468, 60)).error, /button is 468x60; it must be 88x31/);
});

test('plans render as a zone file, a table, and Cloudflare and Route 53 OpenTofu', () => {
  const opts = {
    name: 'Section 72', status: 'open', concept: 'The 90s; in the ${future} %{x}',
    keys: [K1, K2], airlock: 'https://section72.net/airlock',
    banner: `https://section72.net/${'b'.repeat(150)}.png`, caption: 'x'.repeat(140), // over 255 bytes in all
  };
  const plan = planRecords('Section72.NET.', opts);
  assert.equal(plan.domain, 'section72.net');
  assert.equal(plan.records.length, 5);

  // zone: round-trips through the checker; the long banner record is split into 255-byte strings
  const zone = renderPlan(plan, 'zone');
  assert.equal(zone, planZone('section72.net', opts));
  const r = assembleSection('section72.net', parseZone(zone, 'section72.net').found, NOW);
  assert.equal(r.status, 'valid');
  assert.equal(r.section.concept, 'The 90s; in the ${future} %{x}');
  assert.equal(r.section.caption, 'x'.repeat(140));
  assert.match(zone, /^_banner\._timda\.section72\.net\. +300 IN TXT "[^"]{255}" "[^"]+"$/m);

  // table: short and full names
  const table = renderPlan(plan, 'table');
  assert.match(table, /^Name: +_key\._timda +\(in full: _key\._timda\.section72\.net\)$/m);
  assert.equal(table.match(/^Type: +TXT$/gm).length, 5);

  // Cloudflare: one resource per record, quoted content, templates escaped
  const cf = renderPlan(plan, 'cloudflare');
  assert.equal(cf.match(/resource "cloudflare_dns_record"/g).length, 5);
  assert.match(cf, /content = "\\"v=TIMDA1; name=Section 72; status=open; concept=The 90s%3B in the \$\$\{future\} %25\{x\}\\""/); // % is already %25, so no %{ template
  assert.doesNotMatch(cf, /[^$]\$\{future/);

  // Route 53: one record set per name, both keys in it, long values split with ""
  const r53 = renderPlan(plan, 'route53');
  assert.equal(r53.match(/resource "aws_route53_record"/g).length, 4);
  assert.match(r53, /name    = "_key\._timda\.section72\.net"[^]*?records = \[\n    "v=TIMDA1; key=ed25519:[^"]+",\n    "v=TIMDA1; key=ed25519:[^"]+",\n  \]/);
  assert.match(r53, /"v=TIMDA1; url=https:\/\/section72\.net\/b+\.png; caption=x+\\"\\"x+",/);
  assert.throws(() => renderPlan(plan, 'nope'), /unknown format/);
});


test('the inbox record (TIMDA-3): a hub and an optional age key; anything off closes the inbox', () => {
  const AGE = 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p';
  assert.deepEqual(parseInboxRecord('v=TIMDA1; hub=timda.space'), { hub: 'timda.space' });
  assert.deepEqual(parseInboxRecord(`v=TIMDA1; hub=Timda.Space; age=${AGE}`), { hub: 'timda.space', age: AGE });
  assert.match(parseInboxRecord('v=TIMDA1; hub=not a hub').warning, /hub= must name/);
  assert.match(parseInboxRecord('v=TIMDA1; hub=timda.space; age=age1nope').warning, /not an age X25519 public key/);
  const base = { core: ['v=TIMDA1; name=S; status=open'], key: ['v=TIMDA1; key=ed25519:gRfC33kq8uaLHoEvSy5bcmJSP8M64BM8nn7g2atWtkY='] };
  const one = assembleSection('section76.net', { ...base, inbox: [`v=TIMDA1; hub=timda.space; age=${AGE}`] });
  assert.deepEqual(one.section.inbox, { hub: 'timda.space', age: AGE });
  assert.ok(sectionChecks(one).some(([l, t]) => l === 'GOOD' && /inbox: held at timda\.space, encrypted/.test(t)));
  const two = assembleSection('section76.net', { ...base, inbox: ['v=TIMDA1; hub=timda.space', 'v=TIMDA1; hub=other.example'] });
  assert.equal(two.status, 'valid');
  assert.equal(two.section.inbox, undefined);
  assert.match(two.warnings.join(), /inbox closed: 2 records/);
  // planned, and read back the same
  const plan = planRecords('section76.net', { name: 'S', status: 'open', keys: ['ed25519:gRfC33kq8uaLHoEvSy5bcmJSP8M64BM8nn7g2atWtkY='], inbox: 'timda.space', age: AGE });
  assert.deepEqual(plan.records.at(-1), { name: '_inbox._timda.section76.net', content: `v=TIMDA1; hub=timda.space; age=${AGE}` });
  assert.deepEqual(assembleSection('section76.net', parseZone(renderPlan(plan, 'zone'), 'section76.net').found).section.inbox, { hub: 'timda.space', age: AGE });
});
