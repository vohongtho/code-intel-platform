import fs from 'node:fs';
import path from 'node:path';

/**
 * Scan a directory for files matching specific names/extensions, up to maxDepth levels deep.
 */
export function scanForFiles(root: string, matcher: (filename: string) => boolean, maxDepth = 2): string[] {
  const results: string[] = [];
  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        walk(full, depth + 1);
      } else if (entry.isFile() && matcher(entry.name)) {
        results.push(full);
      }
    }
  }
  walk(root, 0);
  return results;
}
