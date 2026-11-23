// The timda CLI's client side: make TIMDA-2 statements, sign them with ssh-keygen,
// hand them to a hub, and check what comes back. Signing and sealing use the real
// tools (ssh-keygen, age) so keys stay wherever they already live: a file, an agent,
// a password manager or a hardware key.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lookupSection } from './timda1.mjs';
import { verifySshsig } from './sshsig.mjs';

const enc = new TextEncoder();

/**
 * A TIMDA-2 statement, ready to sign. `headers` are extra header lines, in order;
 * `body`, if given, follows a blank line and always ends with a newline.
 */
export function makeStatement(type, { from, hub, headers = {}, body, now = new Date(), nonce = randomBytes(16).toString('base64url') }) {
  const lines = [
    'timda-statement: 1', `type: ${type}`, `from: ${from}`, ...(hub ? [`hub: ${hub}`] : []),
    `issued: ${now.toISOString().replace(/\.\d{3}Z$/, 'Z')}`, `nonce: ${nonce}`,
  ];
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || value === '') continue;
    if (/[\r\n]/.test(String(value))) throw new Error(`${name}: must be one line`);
    lines.push(`${name}: ${value}`);
  }
  const head = `${lines.join('\n')}\n`;
  if (body === undefined) return head;
  return `${head}\n${body.replace(/\r\n?/g, '\n').replace(/\n*$/, '\n')}`;
}

/** Run a program with `input` on stdin; resolve with its stdout, or reject with its stderr. */
export function runTool(cmd, args, input) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { reject(e); return; }
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? `${cmd} not found; is it installed?` : e.message)));
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(`${cmd} failed: ${Buffer.concat(err).toString('utf8').trim() || `exit ${code}`}`));
    });
    child.stdin.on('error', () => {}); // a tool that exits early closes its stdin; the exit code says why
    child.stdin.end(input);
  });
}

/** A path as the program will see it: Windows programs on WSL need a Windows path. */
async function toolPath(tool, path) {
  if (!/\.exe$/i.test(tool) || !path.startsWith('/')) return path;
  return (await runTool('wslpath', ['-w', path], '')).trim();
}

/**
 * Sign a statement with `ssh-keygen -Y sign`, reading it from stdin and taking the
 * signature from stdout: with a .pub file, the agent signs (Bitwarden, a YubiKey…).
 */
export async function signStatement(text, { key, sshKeygen = 'ssh-keygen' }) {
  const sig = await runTool(sshKeygen, ['-Y', 'sign', '-f', await toolPath(sshKeygen, key), '-n', 'timda'], text);
  if (!sig.includes('-----BEGIN SSH SIGNATURE-----')) throw new Error(`${sshKeygen} gave no signature`);
  return sig.replace(/\r\n/g, '\n');
}

/** Seal a message body to an age recipient (armoured), or open one with an identity file. */
export const seal = (text, recipient, age = 'age') => runTool(age, ['-a', '-r', recipient], text);
export const unseal = async (armor, identity, age = 'age') => runTool(age, ['-d', '-i', await toolPath(age, identity)], armor);

/** Hand a signed statement to a hub endpoint; resolve with the hub's JSON reply. */
export async function submit(url, text, signature, fetchImpl = fetch) {
  const form = new FormData();
  form.set('statement', new Blob([text]), 'statement.txt');
  form.set('signature', new Blob([signature]), 'statement.txt.sig');
  let res;
  try { res = await fetchImpl(url, { method: 'POST', body: form, headers: { accept: 'application/json' } }); } catch (e) {
    throw new Error(`couldn't reach ${new URL(url).host}: ${e.cause?.message ?? e.message}`);
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw new Error(`${new URL(url).host} didn't answer in JSON (HTTP ${res.status}); is it a TIMDA hub?`);
  return res.json();
}

/** The body of a statement: everything after the first blank line. */
export const statementBody = (text) => {
  const i = text.indexOf('\n\n');
  return i < 0 ? '' : text.slice(i + 2);
};

/**
 * Check a held message the way its recipient should, trusting nothing the hub says:
 * the signature against the sender's keys in DNS now, and the headers against the
 * hub's labels. Returns { ok, key } or { ok: false, error }.
 */
export async function verifyMail(m, { fetchImpl = fetch, now = new Date() } = {}) {
  const head = m.statement.split('\n\n')[0].split('\n');
  const header = (name) => head.find((l) => l.startsWith(`${name}:`))?.slice(name.length + 1).trim();
  if (header('type') !== 'message' || header('from') !== m.from || header('to') !== m.to) {
    return { ok: false, error: 'the statement doesn\'t match what the hub says it is' };
  }
  let looked;
  try { looked = await lookupSection(m.from, { fetchImpl, now }); } catch (e) { return { ok: false, error: `couldn't look ${m.from} up: ${e.message}` }; }
  if (looked.status !== 'valid') return { ok: false, error: `${m.from} has no valid records now, so its keys can't be checked` };
  const sig = await verifySshsig({ message: enc.encode(m.statement), armored: m.signature, namespace: 'timda', allowedKeys: looked.section.key });
  return sig.ok ? { ok: true, key: sig.key } : { ok: false, error: `${sig.error} (or ${m.from} has changed its keys since)` };
}
