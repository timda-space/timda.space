#!/usr/bin/env node
// finger.mjs is now `timda` (tools/timda.mjs). This shim keeps the old spellings
// working and says what the new one is:
//   finger.mjs <domain>                       -> timda finger <domain>
//   finger.mjs --key-from <file.pub>          -> timda key <file.pub>
//   finger.mjs --plan <domain> …              -> timda plan <domain> … (--key-from becomes --key)
//   finger.mjs --check <zone> <domain>        -> timda check <zone> <domain>
//   finger.mjs --allowed-signers [--check <zone>] <domain>
//                                             -> timda signers <domain> [--zone <zone>]

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from './timda.mjs';

/** Translate an old finger.mjs command line into a timda one. */
export function translate(argv) {
  const has = (f) => argv.includes(f);
  const valueOf = (f) => argv[argv.indexOf(f) + 1];
  const without = (...flags) => {
    const out = [];
    for (let i = 0; i < argv.length; i++) {
      if (flags.includes(argv[i])) { if (argv[i] !== '--allowed-signers') i++; continue; }
      out.push(argv[i]);
    }
    return out;
  };
  if (has('--allowed-signers')) {
    const rest = without('--allowed-signers', '--check');
    return ['signers', ...rest, ...(has('--check') ? ['--zone', valueOf('--check')] : [])];
  }
  if (has('--plan')) return ['plan', valueOf('--plan'), ...without('--plan').map((a) => (a === '--key-from' ? '--key' : a))];
  if (has('--check')) return ['check', valueOf('--check'), ...without('--check')];
  if (has('--key-from') && argv.length === 2) return ['key', valueOf('--key-from')];
  return ['finger', ...argv];
}

// Run when executed, not when imported (the tests import translate()).
const invoked = (() => { try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (invoked) {
  const argv = translate(process.argv.slice(2));
  if (process.stderr.isTTY) console.error(`(finger.mjs is now: timda ${argv.join(' ')})\n`);
  run(argv).then((code) => process.exit(code));
}
