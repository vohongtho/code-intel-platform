#!/usr/bin/env node
/**
 * Refresh the Sigstore public-good trusted root pinned into runtime bundles.
 *
 * Reads trusted-root JSON (one document, or JSON Lines as printed by
 * `gh attestation trusted-root`) from stdin, keeps the root whose transparency
 * log is the public-good Rekor instance, and writes it to the pinned path.
 *
 *   gh attestation trusted-root | node scripts/distribution/refresh-sigstore-trusted-root.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.resolve(process.argv[2] || path.join(repoRoot, 'scripts/distribution/trust/sigstore-public-good-trusted-root.json'));

const input = fs.readFileSync(0, 'utf8').trim();
const documents = input.startsWith('{') && !input.includes('\n{') ? [input] : input.split(/\r?\n/).filter((line) => line.trim());
const roots = documents.map((doc) => JSON.parse(doc));
const isPublicGood = (root) => (root.tlogs ?? []).some((tlog) => /(^|\.)sigstore\.dev/.test(new URL(tlog.baseUrl).hostname))
  && (root.certificateAuthorities ?? []).some((ca) => /fulcio\.sigstore\.dev/.test(ca.uri ?? ''));
const selected = roots.filter(isPublicGood);
if (selected.length !== 1) {
  process.stderr.write(`expected exactly one public-good trusted root, found ${selected.length} of ${roots.length}\n`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(selected[0], null, 2)}\n`, 'utf8');
process.stdout.write(`${out}\n`);
