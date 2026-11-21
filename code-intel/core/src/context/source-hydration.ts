/**
 * source-hydration.ts — recover full, correctly-formatted symbol bodies for rendering.
 *
 * Graph rows loaded from the store carry only a prefix of each body (see
 * storage/csv-writer: first 1000 chars, newlines written as the two-character
 * sequence `\n` and not decoded on read). That is unusable for syntax-aware
 * skeletons. Explore re-reads the body from the working tree, read-only and
 * bounded, and only when it provably still matches what was indexed.
 *
 * Safety:
 *  - The resolved real path must stay inside the repository root (no `..`,
 *    absolute-path or symlink escape).
 *  - The working-tree text must match the indexed prefix (in either the stored
 *    escaped form or the in-memory raw form); otherwise the file drifted since
 *    indexing and the indexed content is kept with a `source-drift` boundary
 *    rather than delivering source the index never saw.
 *  - File size and hydrated length are capped.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CodeNode } from '../shared/index.js';
import { escapeNewlines } from '../storage/csv-writer.js';

export const MAX_HYDRATION_FILE_BYTES = 1024 * 1024;
export const MAX_HYDRATED_CHARS = 20_000;

export type HydrationStatus = 'hydrated' | 'skipped';
export type HydrationBoundary = 'source-drift' | 'source-unreadable' | 'source-outside-repo' | 'source-range-missing';

export interface HydrationResult {
  status: HydrationStatus;
  content: string | undefined;
  boundary?: HydrationBoundary;
}


function containedRealPath(repoDir: string, filePath: string): string | null {
  try {
    const root = fs.realpathSync(repoDir);
    const candidate = fs.realpathSync(path.resolve(root, filePath));
    const relative = path.relative(root, candidate);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return candidate;
  } catch {
    return null;
  }
}

export function hydrateNodeSource(node: CodeNode, repoDir: string | undefined): HydrationResult {
  const indexed = node.content;
  if (!indexed || !repoDir || !node.filePath) return { status: 'skipped', content: indexed };
  if (!node.startLine || !node.endLine || node.endLine < node.startLine) {
    return { status: 'skipped', content: indexed, boundary: 'source-range-missing' };
  }

  const resolved = containedRealPath(repoDir, node.filePath);
  if (!resolved) return { status: 'skipped', content: indexed, boundary: 'source-outside-repo' };

  let text: string;
  try {
    if (fs.statSync(resolved).size > MAX_HYDRATION_FILE_BYTES) return { status: 'skipped', content: indexed, boundary: 'source-unreadable' };
    text = fs.readFileSync(resolved, 'utf8');
  } catch {
    return { status: 'skipped', content: indexed, boundary: 'source-unreadable' };
  }

  const body = text.split('\n').slice(node.startLine - 1, node.endLine).join('\n');
  // Escape both sides: the stored form (escaped), the decoded form and raw in-memory content all
  // reduce to the same string, and a source literal `\n` cannot cause a false drift.
  const matches = escapeNewlines(body).startsWith(escapeNewlines(indexed));
  if (!matches) return { status: 'skipped', content: indexed, boundary: 'source-drift' };
  return { status: 'hydrated', content: body.length > MAX_HYDRATED_CHARS ? body.slice(0, MAX_HYDRATED_CHARS) : body };
}
