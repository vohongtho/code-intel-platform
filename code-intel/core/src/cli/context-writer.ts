/**
 * Context file writer — upserts a <!-- code-intel:start/end --> block into
 * AGENTS.md and CLAUDE.md so AI assistants get accurate codebase stats,
 * CLI commands, and skill links immediately after analysis.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SkillSummary } from './skill-writer.js';

const BLOCK_START = '<!-- code-intel:start -->';
const BLOCK_END = '<!-- code-intel:end -->';

export interface ContextStats {
  nodes: number;
  edges: number;
  files: number;
  duration: number;
}

/**
 * Write AGENTS.md and CLAUDE.md at the workspace root.
 * Replaces any existing code-intel block; preserves all other content.
 */
export function writeContextFiles(
  workspaceRoot: string,
  projectName: string,
  stats: ContextStats,
  skills: SkillSummary[],
): void {
  const block = buildBlock(projectName, stats, skills);

  upsertFile(path.join(workspaceRoot, 'AGENTS.md'), block);
  upsertFile(path.join(workspaceRoot, 'CLAUDE.md'), block);
}

// ---------------------------------------------------------------------------
// Block content
// ---------------------------------------------------------------------------

function buildBlock(projectName: string, stats: ContextStats, skills: SkillSummary[]): string {
  const skillRows = skills
    .map((s) => `| Work in \`${s.label}\` (${s.symbolCount} symbols) | \`.claude/skills/code-intel/${s.name}/SKILL.md\` |`)
    .join('\n');

  const skillTable = `| Task | Skill file |
|------|------------|
| Understand architecture / "How does X work?" | Load \`code-intel-exploring\` skill |
| Blast radius / "What breaks if I change X?" | Load \`code-intel-impact\` skill |
| Debugging / "Why is X failing?" | Load \`code-intel-debugging\` skill |
${skillRows ? skillRows + '\n' : ''}`;

  return `${BLOCK_START}
# Code Intelligence — ${projectName}

Indexed: **${stats.nodes.toLocaleString()} nodes** | **${stats.edges.toLocaleString()} edges** | **${stats.files} files** | analyzed in ${(stats.duration / 1000).toFixed(1)}s

> If the index is stale, re-run: \`code-intel analyze\`

## Always Do

- **Before editing any symbol**, run \`code-intel impact <symbol>\` and review blast radius.
- **Before committing**, verify scope with \`code-intel inspect <symbol>\`.
- Use \`code-intel search "<concept>"\` to find related symbols instead of grepping.
- Warn the user if impact shows ≥ 5 direct callers (HIGH risk).

## Never Do

- NEVER rename symbols with find-and-replace — use \`code-intel inspect\` to find all usages first.
- NEVER ignore impact warnings — always report blast radius to the user.

## CLI Quick Reference

\`\`\`bash
code-intel analyze [path]          # Build / refresh the knowledge graph
code-intel serve [path]            # Start HTTP API + Web UI on :4747
code-intel search <query>          # Text search across all symbols
code-intel inspect <symbol>        # Callers, callees, imports, cluster
code-intel impact <symbol>         # Blast radius (who breaks if this changes)
code-intel status [path]           # Index freshness and stats
code-intel clean [path]            # Remove index data
\`\`\`

## Skills

${skillTable}
${BLOCK_END}`;
}

// ---------------------------------------------------------------------------
// File upsert: create → replace block → append
// ---------------------------------------------------------------------------

function upsertFile(filePath: string, block: string): void {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, block + '\n', 'utf-8');
    return;
  }

  const existing = fs.readFileSync(filePath, 'utf-8');
  const startIdx = findLineMarker(existing, BLOCK_START);
  const endIdx = findLineMarker(existing, BLOCK_END, startIdx === -1 ? 0 : startIdx);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing block
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + BLOCK_END.length);
    fs.writeFileSync(filePath, (before + block + after).trimEnd() + '\n', 'utf-8');
    return;
  }

  // Append block
  fs.writeFileSync(filePath, existing.trimEnd() + '\n\n' + block + '\n', 'utf-8');
}

/**
 * Find a marker that stands alone on its own line (not embedded in prose).
 */
function findLineMarker(content: string, marker: string, startFrom = 0): number {
  let idx = content.indexOf(marker, startFrom);
  while (idx !== -1) {
    const atStart = idx === 0 || content[idx - 1] === '\n';
    const end = idx + marker.length;
    const atEnd = end === content.length || content[end] === '\n' || content[end] === '\r';
    if (atStart && atEnd) return idx;
    idx = content.indexOf(marker, idx + 1);
  }
  return -1;
}
