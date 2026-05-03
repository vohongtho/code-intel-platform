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

  // GitHub Copilot (VS Code Copilot Chat, GitHub Copilot CLI)
  const githubDir = path.join(workspaceRoot, '.github');
  if (!fs.existsSync(githubDir)) fs.mkdirSync(githubDir, { recursive: true });
  upsertFile(path.join(githubDir, 'copilot-instructions.md'), block, 'copilot-instructions.md');

  // Cursor IDE
  const cursorDir = path.join(workspaceRoot, '.cursor', 'rules');
  if (!fs.existsSync(cursorDir)) fs.mkdirSync(cursorDir, { recursive: true });
  upsertFile(path.join(cursorDir, 'code-intel.mdc'), block, 'code-intel.mdc');

  // Kiro IDE/CLI
  const kiroDir = path.join(workspaceRoot, '.kiro', 'steering');
  if (!fs.existsSync(kiroDir)) fs.mkdirSync(kiroDir, { recursive: true });
  upsertFile(path.join(kiroDir, 'code-intel.md'), block, 'code-intel.md');
}

// ─── Block content ────────────────────────────────────────────────────────────

function buildBlock(
  projectName: string,
  stats: ContextStats,
  skills: SkillSummary[],
): string {
  const skillTableRows = skills
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
${skillTableRows ? skillTableRows + '\n' : ''}`;

  const skillLoadInstructions = skills.length > 0
    ? `\n## When to Load a Skill\n\nBefore working deeply in a subsystem, **load the matching skill file** listed above.\nEach skill gives you symbol maps, key entry points, and safe-change guidance for that area.\n\n${skills.map((s) => `- Working in **${s.label}**? → Load \`.claude/skills/code-intel/${s.name}/SKILL.md\``).join('\n')}\n`
    : '';

  return `${BLOCK_START}
# Code Intelligence — ${projectName}

> ⚠ This section is auto-managed by \`code-intel analyze\`. Do **not** edit between the markers — your changes will be overwritten.
> Add your own notes below the \`${BLOCK_END}\` marker.

Indexed: **${stats.nodes.toLocaleString()} nodes** | **${stats.edges.toLocaleString()} edges** | **${stats.files} files** | analyzed in ${(stats.duration / 1000).toFixed(1)}s

> Index stale? Re-run: \`code-intel analyze\`

## Mandatory Rules — ALL Agents (Amp, Claude Code, Codex, Copilot, Cursor, Aider, Gemini, Kiro, Trae, Hermes, Factory, OpenCode, Pi, Antigravity, OpenClaw, and others)

These rules apply to **every coding agent or AI assistant** working in this repository.

### Before Implementing Any Change
1. Run \`code-intel search "<concept>"\` — find existing symbols related to the task.
2. Run \`code-intel inspect <symbol>\` — understand callers, callees, and imports.
3. Run \`code-intel impact <symbol>\` — check blast radius before touching anything.
4. **If impact shows ≥ 5 direct callers → warn the user: HIGH risk.**

### While Implementing / Fixing a Bug
- NEVER open a file cold — always \`code-intel search\` first.
- NEVER grep for symbols — use \`code-intel search\` instead.
- NEVER rename symbols with find-and-replace — use \`code-intel inspect\` to find all usages first.
- Use \`code-intel query summarize <symbol>\` to understand a function before modifying it.
- Use \`code-intel query flows <symbol>\` to trace execution paths through complex logic.

### Before Committing / Code Review
- Run \`code-intel impact <symbol>\` for every symbol you changed.
- Run \`code-intel pr-impact --base main --head HEAD\` to see full PR blast radius.
- Fail PR if HIGH risk symbols are changed without reviewer sign-off.

### Studying the Codebase
- Use \`code-intel search "<concept>"\` to explore unfamiliar areas.
- Use \`code-intel inspect <symbol>\` to see a symbol's full context.
- Use \`code-intel serve\` to open the interactive Web UI for graph exploration.
- Use subsystem skills (see table below) for deep-dive on a specific area.

## Never Do

- NEVER ignore impact warnings — always report blast radius to the user.
- NEVER skip \`code-intel search\` before grepping or opening files.
- NEVER make changes to a symbol with ≥ 5 callers without running \`code-intel impact\` first.
- NEVER use find-and-replace for symbol renames.

## Development Workflow

### 🔧 Implement a New Feature
\`\`\`
1. code-intel search "<feature concept>"      # find related existing symbols
2. code-intel inspect <related-symbol>        # understand context & callers
3. Load subsystem skill (see Skills table)    # deep-dive the area
4. Implement changes
5. code-intel impact <changed-symbol>         # verify blast radius
6. code-intel pr-impact --base main           # full PR summary before commit
\`\`\`

### 🐛 Fix a Bug
\`\`\`
1. code-intel search "<buggy behavior>"       # locate the symbol
2. code-intel query flows <symbol>            # trace execution path
3. code-intel inspect <symbol>                # find all callers that may be affected
4. Fix the bug
5. code-intel impact <symbol>                 # confirm no unexpected side effects
\`\`\`

### 🔬 Study / Understand Code
\`\`\`
1. code-intel search "<concept>"              # discover entry points
2. code-intel query summarize <symbol>        # AI explanation of a function
3. code-intel query flows <symbol>            # execution flow diagram
4. code-intel inspect <symbol>                # full context: callers, callees, imports
5. Load subsystem skill                       # structured deep-dive
\`\`\`

### 👀 Code Review
\`\`\`
1. code-intel pr-impact --base main --head HEAD   # blast radius of all PR changes
2. code-intel impact <each-changed-symbol>         # per-symbol risk check
3. Flag HIGH risk (≥ 5 callers) for reviewer sign-off
\`\`\`

### 🔄 Maintain / Refactor
\`\`\`
1. code-intel inspect <symbol>                # find ALL usages before touching
2. code-intel impact <symbol>                 # blast radius — plan your changes
3. Make changes incrementally
4. code-intel pr-impact --base main           # validate scope hasn't exploded
\`\`\`

## CLI Quick Reference

\`\`\`bash
code-intel analyze [path]                      # Build / refresh the knowledge graph
code-intel serve [path]                        # Start HTTP API + Web UI on :4747
code-intel search <query>                      # Find symbols by concept/name
code-intel inspect <symbol>                    # Callers, callees, imports, cluster
code-intel impact <symbol>                     # Blast radius (who breaks if this changes)
code-intel query summarize <symbol>            # AI summary of a symbol
code-intel query flows <symbol>                # Execution flows through a symbol
code-intel pr-impact --base main --head HEAD   # Full PR blast radius report
code-intel status [path]                       # Index freshness and stats
code-intel clean [path]                        # Remove index data
\`\`\`

## Skills
${skillLoadInstructions}
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
