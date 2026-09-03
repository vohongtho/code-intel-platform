import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export const CONTENT_FINGERPRINTS_FILE = 'content-fingerprints.json';

/**
 * Per-node declaration content fingerprints, keyed by canonical node ID.
 *
 * The persisted `CodeNode.content` field is not a reliable source for this:
 * `file` nodes are truncated to the first 2000 characters
 * (pipeline/phases/parse-phase.ts) and `function`/`method`/`class`/etc. nodes
 * never get a `content` value at all — it's `undefined` on every symbol node
 * read back from graph.db. Without a real per-node content fingerprint,
 * neither "did this function's body change" (graph-diff.ts) nor "did this
 * declaration move/get renamed" (continuity.ts) can work.
 *
 * `node.startLine`/`node.endLine` are also not sufficient on their own: for
 * most symbol kinds they mark a single anchor line (the declaration line),
 * not the full body span — `startLine === endLine` for a multi-line function
 * is normal, not a bug in the extractor. This module instead estimates each
 * node's span as "from its own startLine up to (but not including) the next
 * node's startLine in the same file" — sorting all of a file's nodes by
 * position is a language-agnostic way to approximate a declaration's extent
 * without a brace/indentation-aware parser for every supported language.
 *
 * This is a heuristic, not an exact body boundary: for a container whose
 * first member starts a few lines in (e.g. a class), the container's own
 * span gets truncated to just before that member, so a change to the
 * container's own content only (its `extends` clause, a decorator) that
 * isn't otherwise reflected in a member's span may not be detected as a
 * change on the container node itself — the common case of "did this
 * function/method/member's body change" is unaffected, since leaf nodes
 * still get an accurate span up to their next sibling.
 *
 * Computed once, while the ref's source is still materialized in the
 * (about-to-be-deleted) build worktree, and persisted as a small sidecar
 * JSON file alongside the snapshot's other artifacts so it survives after
 * the worktree is gone.
 */
function groupNodesByFile(graph: KnowledgeGraph): Map<string, { id: string; startLine: number }[]> {
  const nodesByFile = new Map<string, { id: string; startLine: number }[]>();
  for (const node of graph.allNodes()) {
    if (node.startLine === undefined || !node.filePath) continue;
    const list = nodesByFile.get(node.filePath);
    if (list) list.push({ id: node.id, startLine: node.startLine });
    else nodesByFile.set(node.filePath, [{ id: node.id, startLine: node.startLine }]);
  }
  return nodesByFile;
}

function fingerprintFileNodes(lines: string[], entries: { id: string; startLine: number }[], out: Record<string, string>): void {
  const sorted = [...entries].sort((a, b) => a.startLine - b.startLine);
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    const next = sorted[i + 1];
    const start = Math.max(0, current.startLine - 1);
    const end = next && next.startLine > current.startLine ? next.startLine - 1 : lines.length;
    if (start >= end) continue;
    const declarationText = lines.slice(start, end).join('\n');
    out[current.id] = crypto.createHash('sha256').update(declarationText).digest('hex');
  }
}

function readFileLines(worktreeDir: string, filePath: string): string[] | null {
  try {
    return fs.readFileSync(path.join(worktreeDir, filePath), 'utf8').split('\n');
  } catch {
    return null;
  }
}

export function computeContentFingerprints(worktreeDir: string, graph: KnowledgeGraph): Record<string, string> {
  const fingerprints: Record<string, string> = {};
  for (const [filePath, entries] of groupNodesByFile(graph)) {
    const lines = readFileLines(worktreeDir, filePath);
    if (!lines) continue;
    fingerprintFileNodes(lines, entries, fingerprints);
  }
  return fingerprints;
}

export function writeContentFingerprints(artifactsDir: string, fingerprints: Record<string, string>): void {
  const target = path.join(artifactsDir, CONTENT_FINGERPRINTS_FILE);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(fingerprints));
  fs.renameSync(tmp, target);
}

export function readContentFingerprints(artifactsDir: string): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(path.join(artifactsDir, CONTENT_FINGERPRINTS_FILE), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}
