/**
 * Self-update checker — code-intel update
 *
 * - Checks npm registry for newer version
 * - Caches last-check timestamp in ~/.code-intel/meta.json
 * - Background check is non-blocking (fire-and-forget)
 * - Suppressed by --no-update-check flag or UPDATE_CHECK_DISABLED env var
 * - Check interval controlled by UPDATE_CHECK_INTERVAL env var (default: 24h)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GLOBAL_DIR = path.join(os.homedir(), '.code-intel');
const META_PATH = path.join(GLOBAL_DIR, 'update-meta.json');
const PACKAGE_NAME = 'code-intel';
const NPM_REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;

// ── Meta persistence ──────────────────────────────────────────────────────────

interface UpdateMeta {
  lastCheckedAt: string;
  latestVersion?: string;
}

function loadMeta(): UpdateMeta | null {
  try {
    return JSON.parse(fs.readFileSync(META_PATH, 'utf-8')) as UpdateMeta;
  } catch {
    return null;
  }
}

function saveMeta(meta: UpdateMeta): void {
  fs.mkdirSync(GLOBAL_DIR, { recursive: true });
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
}

// ── Version comparison ────────────────────────────────────────────────────────

/** Returns true if `candidate` is newer than `current` (semver). */
export function isNewer(current: string, candidate: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [cMaj, cMin, cPat] = parse(current);
  const [nMaj, nMin, nPat] = parse(candidate);
  if (nMaj !== cMaj) return (nMaj ?? 0) > (cMaj ?? 0);
  if (nMin !== cMin) return (nMin ?? 0) > (cMin ?? 0);
  return (nPat ?? 0) > (cPat ?? 0);
}

// ── Fetch latest version from npm ─────────────────────────────────────────────

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const resp = await fetch(NPM_REGISTRY_URL, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const data = await resp.json() as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

// ── Check interval ────────────────────────────────────────────────────────────

function getIntervalMs(): number {
  const envHours = parseInt(process.env['UPDATE_CHECK_INTERVAL'] ?? '', 10);
  const hours = Number.isFinite(envHours) && envHours > 0 ? envHours : 24;
  return hours * 60 * 60 * 1000;
}

function isSuppressed(): boolean {
  return (
    process.env['UPDATE_CHECK_DISABLED'] === '1' ||
    process.env['UPDATE_CHECK_DISABLED'] === 'true' ||
    process.argv.includes('--no-update-check')
  );
}

// ── Background startup check (non-blocking) ───────────────────────────────────

/**
 * Fire-and-forget version check. Prints a one-line notice to stderr if
 * a newer version is available. Never throws or blocks startup.
 */
export function backgroundVersionCheck(currentVersion: string): void {
  if (isSuppressed()) return;

  // Check if enough time has passed since last check
  const meta = loadMeta();
  if (meta?.lastCheckedAt) {
    const elapsed = Date.now() - new Date(meta.lastCheckedAt).getTime();
    if (elapsed < getIntervalMs()) {
      // Still within interval — check cached result only
      if (meta.latestVersion && isNewer(currentVersion, meta.latestVersion)) {
        process.stderr.write(
          `  ℹ  code-intel v${meta.latestVersion} is available (current: v${currentVersion}). Run \`code-intel update\` to upgrade.\n`,
        );
      }
      return;
    }
  }

  // Do a background fetch (fire-and-forget, don't await)
  void (async () => {
    try {
      const latest = await fetchLatestVersion();
      if (!latest) return;
      saveMeta({ lastCheckedAt: new Date().toISOString(), latestVersion: latest });
      if (isNewer(currentVersion, latest)) {
        process.stderr.write(
          `  ℹ  code-intel v${latest} is available (current: v${currentVersion}). Run \`code-intel update\` to upgrade.\n`,
        );
      }
    } catch {
      // Silently ignore — update check should never break the CLI
    }
  })();
}

// ── Interactive update command ────────────────────────────────────────────────

export async function runUpdate(opts: { yes?: boolean } = {}): Promise<void> {
  console.log('\n  ◈  code-intel — Self Update\n');

  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { join, dirname } = await import('node:path');

  // Resolve current version from the installed package.json
  let currentVersion = '0.0.0';
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as { version: string };
    currentVersion = pkg.version;
  } catch {
    // Fallback: can't determine current version
  }

  console.log(`  Current version : v${currentVersion}`);
  console.log('  Checking npm registry…\n');

  const latest = await fetchLatestVersion();

  if (!latest) {
    console.error('  ✗  Could not reach npm registry. Check your internet connection.\n');
    process.exit(1);
  }

  saveMeta({ lastCheckedAt: new Date().toISOString(), latestVersion: latest });

  if (!isNewer(currentVersion, latest)) {
    console.log(`  ✅  Already up to date (v${currentVersion}).\n`);
    return;
  }

  console.log(`  Latest version  : v${latest}`);
  console.log('');

  let doUpdate = opts.yes;
  if (!doUpdate) {
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = (await rl.question(`  New version v${latest} available. Update now? [y/N]: `)).trim().toLowerCase();
    rl.close();
    doUpdate = ans === 'y' || ans === 'yes';
  }

  if (!doUpdate) {
    console.log('  Cancelled.\n');
    return;
  }

  const { execSync } = await import('node:child_process');
  console.log(`  Installing code-intel@${latest}…\n`);
  try {
    execSync(`npm install -g ${PACKAGE_NAME}@${latest}`, { stdio: 'inherit' });
    console.log(`\n  ✅  Updated to v${latest}. Run \`code-intel --version\` to verify.\n`);
  } catch (err) {
    console.error(`\n  ✗  Update failed: ${err instanceof Error ? err.message : err}`);
    console.error('     Try manually: npm install -g code-intel\n');
    process.exit(1);
  }
}
