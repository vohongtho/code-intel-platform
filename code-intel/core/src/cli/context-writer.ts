/**
 * context-writer.ts
 *
 * Writes/updates selected agent instruction files at the workspace root.
 *
 * Rules:
 *  1. File does NOT exist  → create a new file with a standard template that
 *     includes the auto-managed block AND a clearly marked section for the
 *     user's own custom content.
 *
 *  2. File ALREADY exists AND contains the markers
 *     <!-- code-intel:start --> … <!-- code-intel:end -->
 *     → replace ONLY the content between (and including) those markers.
 *       Everything else in the file is left untouched.
 *
 *  3. File ALREADY exists but has NO markers yet
 *     → append the block at the end (never overwrite existing content).
 *
 *  4. JSON targets keep any existing keys and update only the managed
 *     `code-intel` property.
 *
 * The `--skip-agents-md` flag prevents this function from being called at all.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentTargetConfig } from '../storage/metadata.js';
import { LEGACY_CONTEXT_TARGETS } from './agent-targets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_VERSION = readPackageVersion();

const BLOCK_START = '<!-- code-intel:start -->';
const BLOCK_END   = '<!-- code-intel:end -->';
const JSON_KEY = 'code-intel';

export interface ContextStats {
  nodes: number;
  edges: number;
  files: number;
  duration: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function writeContextFiles(
  workspaceRoot: string,
  projectName: string,
  stats: ContextStats,
  targets: AgentTargetConfig[] = LEGACY_CONTEXT_TARGETS,
): void {
  const block = buildBlock(projectName, stats);
  const dedupedTargets = new Map<string, AgentTargetConfig>();
  for (const target of targets) {
    dedupedTargets.set(target.path, target);
  }

  for (const target of dedupedTargets.values()) {
    const filePath = path.join(workspaceRoot, target.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (target.format === 'json') {
      upsertJsonFile(filePath, block);
      continue;
    }
    upsertFile(filePath, block, path.basename(target.path) || target.path);
  }
}

// ─── Block content ────────────────────────────────────────────────────────────

function buildBlock(
  projectName: string,
  stats: ContextStats,
): string {
  const version = PACKAGE_VERSION || 'unknown';

  return `${BLOCK_START}
# Code Intelligence — ${projectName}

> Auto-managed by \`code-intel analyze\` (v${version}) — re-running it overwrites this block. Put durable notes below \`${BLOCK_END}\`.

\`code-intel\` keeps a symbol / call-graph index of this repo. It **complements** reading files, it doesn't replace it — on a repo this size, read files directly for most work and reach for code-intel when you need the call graph.

## Reach for it when you need
- **Blast radius before changing a shared symbol** — \`code-intel impact <symbol>\` (reverse call graph). Flag ≥ 5 direct callers to the user as higher-risk.
- **PR review scope** — \`code-intel pr-impact --base master --head HEAD\`
- **Callers / callees of a symbol** — \`code-intel inspect <symbol>\`
- **Concept search across files** — \`code-intel search "<concept>"\`
- **Tracing an execution path** — \`code-intel query "TRAVERSE CALLS FROM '<symbol>' DEPTH 3"\`

## CLI reference

\`\`\`bash
code-intel search <query>            # find symbols by concept/name
code-intel inspect <symbol>          # callers, callees, imports
code-intel impact <symbol>           # blast radius (who breaks if this changes)
code-intel pr-impact --base master   # full PR blast radius
code-intel query "TRAVERSE CALLS FROM '<symbol>' DEPTH 3"
code-intel query "PATH FROM '<sym>' TO '<target>'"
code-intel analyze                   # rebuild the index (run when stale)
code-intel serve                     # HTTP API + web UI on :4747
\`\`\`

Also available: \`complexity\`, \`coverage\`, \`secrets\`, \`scan\`, \`deprecated\`, \`status\`, \`clean\`.
${BLOCK_END}`;
}

// ─── File upsert ─────────────────────────────────────────────────────────────

function upsertFile(filePath: string, block: string, fileName: string): void {
  // ── Case 1: file does not exist → create from template ──────────────────
  if (!fs.existsSync(filePath)) {
    const newContent = [
      `# ${fileName}`,
      '',
      block,
      '',
      '---',
      '',
      '<!-- Add your own custom notes below this line. They will never be overwritten by code-intel. -->',
      '',
    ].join('\n');
    fs.writeFileSync(filePath, newContent, 'utf-8');
    return;
  }

  const existing = fs.readFileSync(filePath, 'utf-8');
  const startIdx = findLineMarker(existing, BLOCK_START);
  const endIdx   = findLineMarker(existing, BLOCK_END, startIdx === -1 ? 0 : startIdx);

  // ── Case 2: markers found → replace only the managed block ──────────────
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx);
    const after  = existing.slice(endIdx + BLOCK_END.length);
    const updated = (before + block + after).trimEnd() + '\n';
    fs.writeFileSync(filePath, updated, 'utf-8');
    return;
  }

  // ── Case 3: file exists but has no markers → append block ───────────────
  const appended = [
    existing.trimEnd(),
    '',
    '---',
    '',
    '<!-- The following section is auto-managed by code-intel. Do not edit between the markers. -->',
    '',
    block,
    '',
  ].join('\n');
  fs.writeFileSync(filePath, appended, 'utf-8');
}

function upsertJsonFile(filePath: string, block: string): void {
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  const updated = {
    ...existing,
    [JSON_KEY]: block,
  };
  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
}

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Find a marker that occupies its own line (not embedded mid-line in prose).
 */
function findLineMarker(content: string, marker: string, startFrom = 0): number {
  let idx = content.indexOf(marker, startFrom);
  while (idx !== -1) {
    const atLineStart = idx === 0 || content[idx - 1] === '\n';
    const end = idx + marker.length;
    const atLineEnd =
      end === content.length || content[end] === '\n' || content[end] === '\r';
    if (atLineStart && atLineEnd) return idx;
    idx = content.indexOf(marker, idx + 1);
  }
  return -1;
}
