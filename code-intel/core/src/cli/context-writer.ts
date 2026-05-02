/**
 * context-writer.ts
 *
 * Writes/updates AGENTS.md and CLAUDE.md at the workspace root.
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
 * The `--skip-agents-md` flag prevents this function from being called at all.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SkillSummary } from './skill-writer.js';

const BLOCK_START = '<!-- code-intel:start -->';
const BLOCK_END   = '<!-- code-intel:end -->';

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
  skills: SkillSummary[],
): void {
  const block = buildBlock(projectName, stats, skills);
  upsertFile(path.join(workspaceRoot, 'AGENTS.md'), block, 'AGENTS.md');
  upsertFile(path.join(workspaceRoot, 'CLAUDE.md'),  block, 'CLAUDE.md');
}

// ─── Block content ────────────────────────────────────────────────────────────

function buildBlock(
  projectName: string,
  stats: ContextStats,
  skills: SkillSummary[],
): string {
  const skillRows = skills
    .map(
      (s) =>
        `| Work in \`${s.label}\` (${s.symbolCount} symbols) | \`.claude/skills/code-intel/${s.name}/SKILL.md\` |`,
    )
    .join('\n');

  const skillTable = `| Task | Skill file |
|------|------------|
| Understand architecture / "How does X work?" | Load \`code-intel-exploring\` skill |
| Blast radius / "What breaks if I change X?" | Load \`code-intel-impact\` skill |
| Debugging / "Why is X failing?" | Load \`code-intel-debugging\` skill |
${skillRows ? skillRows + '\n' : ''}`;

  return `${BLOCK_START}
# Code Intelligence — ${projectName}

> ⚠ This section is auto-managed by \`code-intel analyze\`. Do **not** edit between the markers — your changes will be overwritten.
> Add your own notes below the \`${BLOCK_END}\` marker.

Indexed: **${stats.nodes.toLocaleString()} nodes** | **${stats.edges.toLocaleString()} edges** | **${stats.files} files** | analyzed in ${(stats.duration / 1000).toFixed(1)}s

> Index stale? Re-run: \`code-intel analyze\`

## Always Do

- **Before editing any symbol**, run \`code-intel impact <symbol>\` to review its blast radius.
- **Before committing**, verify scope with \`code-intel inspect <symbol>\`.
- Use \`code-intel search "<concept>"\` to find related symbols instead of grepping.
- Warn the user if impact shows ≥ 5 direct callers (**HIGH risk**).

## Never Do

- NEVER rename symbols with find-and-replace — use \`code-intel inspect\` to find all usages first.
- NEVER ignore impact warnings — always report blast radius to the user.
- NEVER open a file cold — always \`code-intel search\` first.
- NEVER grep for symbols — use \`code-intel search\` instead.

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
