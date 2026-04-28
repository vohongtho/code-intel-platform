/**
 * Filesystem helpers that enforce restrictive POSIX permissions on
 * `.code-intel/` directories and the secret-bearing files inside them.
 *
 * Behaviour:
 *   - Directories are created with mode 0o700 (owner-only access).
 *   - Files are chmod'd to 0o600 (owner read/write only).
 *   - On Windows (`process.platform === 'win32'`), chmod is largely a no-op;
 *     callers should use ACLs instead. We still issue the calls so the
 *     intent is documented and tested on POSIX.
 */

import fs from 'node:fs';
import path from 'node:path';

const SECURE_DIR_MODE = 0o700;
const SECURE_FILE_MODE = 0o600;

/**
 * Create `dir` (and parents) with mode 0o700. Idempotent: if the directory
 * already exists with a looser mode, tighten it back to 0o700.
 */
export function secureMkdir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: SECURE_DIR_MODE });
  // Re-apply mode in case the directory pre-existed with looser perms.
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(dir, SECURE_DIR_MODE);
    } catch {
      /* not fatal — read-only filesystems, ACL'd parents */
    }
  }
}

/**
 * chmod a file to 0o600. Safe to call on Windows (no-op).
 */
export function secureChmodFile(file: string): void {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(file, SECURE_FILE_MODE);
  } catch {
    /* swallow — best-effort */
  }
}

/**
 * Write a file with mode 0o600 in a single atomic step. Creates parent dirs
 * with secureMkdir first.
 */
export function secureWriteFile(file: string, data: string | Buffer): void {
  secureMkdir(path.dirname(file));
  fs.writeFileSync(file, data, { mode: SECURE_FILE_MODE });
  // Re-apply explicit chmod for the case where the file already existed.
  secureChmodFile(file);
}

/**
 * Apply 0o600 to every `*.db` file inside `dir` (non-recursive). Used after
 * subsystems that wrap better-sqlite3 to seal the freshly-created DB files.
 */
export function tightenDbFiles(dir: string): void {
  if (process.platform === 'win32') return;
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.db') || name.endsWith('.db-wal') || name.endsWith('.db-shm')) {
      try {
        fs.chmodSync(path.join(dir, name), SECURE_FILE_MODE);
      } catch {
        /* best-effort */
      }
    }
  }
}

export const SECURE_MODES = {
  dir: SECURE_DIR_MODE,
  file: SECURE_FILE_MODE,
};
