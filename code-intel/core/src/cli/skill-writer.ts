/**
 * Skill file writer — generates .claude/skills/code-intel/ SKILL.md files
 * from the knowledge graph clusters, giving AI assistants structured,
 * high-accuracy context for each functional area of the codebase.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { CodeNode, CodeEdge } from '../shared/index.js';

export interface SkillSummary {
  name: string;
  label: string;
  symbolCount: number;
  fileCount: number;
}

interface AreaInfo {
  label: string;
  dir: string;
  nodes: CodeNode[];
  files: Map<string, CodeNode[]>;            // relPath -> nodes
  entryPoints: CodeNode[];                   // exported, not called by others
  hotNodes: { node: CodeNode; inDeg: number; outDeg: number }[];  // highest degree
  callEdgesInArea: number;                   // density signal
  flowIds: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function writeSkillFiles(
  graph: KnowledgeGraph,
  workspaceRoot: string,
  projectName: string,
): Promise<{ skills: SkillSummary[]; outputDir: string }> {
  const outputDir = path.join(workspaceRoot, '.claude', 'skills', 'code-intel');

  const areas = buildAreaMap(graph, workspaceRoot);
  if (areas.length === 0) return { skills: [], outputDir };

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const skills: SkillSummary[] = [];
  const usedNames = new Set<string>();

  for (const area of areas) {
    const kebab = uniqueKebab(area.label, usedNames);
    usedNames.add(kebab);

    const content = renderSkill(area, projectName, kebab);
    const dir = path.join(outputDir, kebab);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf-8');

    skills.push({ name: kebab, label: area.label, symbolCount: area.nodes.length, fileCount: area.files.size });
  }

  return { skills, outputDir };
}

// ---------------------------------------------------------------------------
// Build area map from cluster nodes
// ---------------------------------------------------------------------------

function buildAreaMap(graph: KnowledgeGraph, workspaceRoot: string): AreaInfo[] {
  // Index cluster labels
  const clusterLabel = new Map<string, string>();
  const clusterMembers = new Map<string, CodeNode[]>();

  for (const node of graph.allNodes()) {
    if (node.kind === 'cluster') {
      clusterLabel.set(node.id, node.name);
      clusterMembers.set(node.id, []);
    }
  }

  // Assign members via belongs_to
  for (const edge of graph.findEdgesByKind('belongs_to')) {
    const bucket = clusterMembers.get(edge.target);
    const node = graph.getNode(edge.source);
    if (bucket && node) bucket.push(node);
  }

  // Precompute degree maps for hot-node detection
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  const calledIds = new Set<string>();

  for (const edge of graph.findEdgesByKind('calls')) {
    calledIds.add(edge.target);
    inDeg.set(edge.target, (inDeg.get(edge.target) ?? 0) + 1);
    outDeg.set(edge.source, (outDeg.get(edge.source) ?? 0) + 1);
  }

  const areas: AreaInfo[] = [];

  for (const [clusterId, members] of clusterMembers) {
    if (members.length < 3) continue;

    const label = clusterLabel.get(clusterId) ?? 'unknown';
    const dir = members[0]?.filePath.split('/').slice(0, -1).join('/') ?? '';

    // Group by relative file path
    const files = new Map<string, CodeNode[]>();
    for (const n of members) {
      const rel = relPath(n.filePath, workspaceRoot);
      let list = files.get(rel);
      if (!list) { list = []; files.set(rel, list); }
      list.push(n);
    }

    // Entry points: exported, not called from outside, callable kinds
    const entryPoints = members
      .filter((n) => n.exported && !calledIds.has(n.id) && ['function', 'method', 'class'].includes(n.kind))
      .slice(0, 6);

    // Hot nodes: highest combined degree (most connected = most important)
    const memberIds = new Set(members.map((n) => n.id));
    const hotNodes = members
      .map((n) => ({ node: n, inDeg: inDeg.get(n.id) ?? 0, outDeg: outDeg.get(n.id) ?? 0 }))
      .sort((a, b) => (b.inDeg + b.outDeg) - (a.inDeg + a.outDeg))
      .slice(0, 12);

    // Internal call density
    let callEdgesInArea = 0;
    for (const edge of graph.findEdgesByKind('calls')) {
      if (memberIds.has(edge.source) && memberIds.has(edge.target)) callEdgesInArea++;
    }

    // Flows touching this area
    const flowIds: string[] = [];
    for (const node of graph.allNodes()) {
      if (node.kind !== 'flow') continue;
      const steps = node.metadata?.steps as string[] | undefined;
      if (steps?.some((s) => memberIds.has(s))) flowIds.push(node.id);
      if (flowIds.length >= 8) break;
    }

    areas.push({ label, dir, nodes: members, files, entryPoints, hotNodes, callEdgesInArea, flowIds });
  }

  areas.sort((a, b) => b.nodes.length - a.nodes.length);
  return areas.slice(0, 20);
}

// ---------------------------------------------------------------------------
// Render optimized SKILL.md
// ---------------------------------------------------------------------------

function renderSkill(area: AreaInfo, projectName: string, kebabName: string): string {
  const density = area.nodes.length > 0
    ? Math.round((area.callEdgesInArea / area.nodes.length) * 10) / 10
    : 0;

  const topEntryNames = area.entryPoints.slice(0, 3).map((n) => n.name);
  const topHotNames = area.hotNodes.slice(0, 3).map((h) => h.node.name);

  // Pick best symbol names for description triggers
  const triggerNames = topEntryNames.length > 0 ? topEntryNames : topHotNames;
  const triggerStr = triggerNames.map((n) => `\`${n}\``).join(', ');

  // Dominant directory for scoping hint
  const dirs = [...area.files.keys()].map((f) => f.split('/').slice(0, -1).join('/') || '.');
  const dirCounts = new Map<string, number>();
  for (const d of dirs) dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
  const dominantDir = [...dirCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? area.dir;

  const lines: string[] = [];

  // --- Frontmatter ---
  const description = [
    `Covers the **${area.label}** subsystem of ${projectName}.`,
    `${area.nodes.length} symbols across ${area.files.size} files.`,
    triggerStr ? `Key symbols: ${triggerStr}.` : '',
    `Internal call density: ${density} calls/symbol.`,
    area.flowIds.length > 0 ? `Participates in ${area.flowIds.length} execution flow(s).` : '',
  ].filter(Boolean).join(' ');

  lines.push('---');
  lines.push(`name: ${kebabName}`);
  lines.push(`description: "${description.replace(/"/g, "'")}"`);
  lines.push('---', '');

  // --- Title block ---
  lines.push(`# ${area.label}`);
  lines.push('');
  lines.push(`> **${area.nodes.length} symbols** | **${area.files.size} files** | path: \`${dominantDir}/\` | call density: ${density}/sym`);
  lines.push('');

  // --- When to Use (precise triggers for the AI) ---
  lines.push('## When to Use');
  lines.push('');
  lines.push('Load this skill when:');
  lines.push(`- The task involves code in \`${dominantDir}/\``);
  if (triggerStr) lines.push(`- The user mentions ${triggerStr} or asks how they work`);
  lines.push(`- Adding, modifying, or debugging ${area.label.toLowerCase()}-related functionality`);
  lines.push(`- Tracing call chains that pass through the ${area.label} layer`);
  lines.push('');

  // --- Key Files ---
  lines.push('## Key Files');
  lines.push('');
  lines.push('| File | Symbols | Notes |');
  lines.push('|------|---------|-------|');
  const sortedFiles = [...area.files.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [file, nodes] of sortedFiles.slice(0, 10)) {
    const exported = nodes.filter((n) => n.exported);
    const names = nodes.slice(0, 4).map((n) => `\`${n.name}\``).join(', ');
    const extra = nodes.length > 4 ? ` +(${nodes.length - 4})` : '';
    const note = exported.length > 0 ? `${exported.length} exported` : 'internal';
    lines.push(`| \`${file}\` | ${names}${extra} | ${note} |`);
  }
  lines.push('');

  // --- Entry Points ---
  if (area.entryPoints.length > 0) {
    lines.push('## Entry Points');
    lines.push('');
    lines.push('Start exploration here — exported symbols with no external callers:');
    lines.push('');
    for (const ep of area.entryPoints) {
      const loc = ep.startLine ? `:${ep.startLine}` : '';
      lines.push(`- **\`${ep.name}\`** \`(${ep.kind})\` → \`${ep.filePath}${loc}\``);
    }
    lines.push('');
  }

  // --- Hot Symbols (most connected = highest impact) ---
  lines.push('## Hot Symbols');
  lines.push('');
  lines.push('Sorted by call graph degree (changing these has the highest blast radius):');
  lines.push('');
  lines.push('| Symbol | Kind | In ← | → Out | File |');
  lines.push('|--------|------|-----:|------:|------|');
  for (const { node: n, inDeg: i, outDeg: o } of area.hotNodes) {
    lines.push(`| \`${n.name}\` | ${n.kind} | ${i} | ${o} | \`${relFile(n.filePath)}\` |`);
  }
  lines.push('');

  // --- Execution Flows ---
  if (area.flowIds.length > 0) {
    lines.push('## Execution Flows');
    lines.push('');
    lines.push(`**${area.flowIds.length}** execution path(s) pass through this area.`);
    lines.push('Run `code-intel inspect <symbol>` on a hot symbol to trace the full call chain.');
    lines.push('');
  }

  // --- Impact Guidance ---
  lines.push('## Impact Guidance');
  lines.push('');
  lines.push('Before modifying any symbol in this area:');
  lines.push(`1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures`);
  lines.push(`2. **Entry points** — changes propagate to external consumers`);
  lines.push(`3. Run \`code-intel impact <symbol>\` to get full blast radius`);
  lines.push('');

  // --- Quick Commands ---
  const firstHot = area.hotNodes[0]?.node.name ?? area.nodes[0]?.name ?? area.label;
  const firstEntry = area.entryPoints[0]?.name ?? firstHot;
  lines.push('## Quick Commands');
  lines.push('');
  lines.push('```bash');
  lines.push(`# Inspect most-connected symbol`);
  lines.push(`code-intel inspect ${firstHot}`);
  lines.push(`# Blast radius for entry point`);
  lines.push(`code-intel impact ${firstEntry}`);
  lines.push(`# Search this area`);
  lines.push(`code-intel search "${area.label.toLowerCase()}"`);
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function uniqueKebab(label: string, used: Set<string>): string {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'skill';
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) { candidate = `${base}-${n++}`; }
  return candidate;
}

function relPath(filePath: string, workspaceRoot: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/?$/, '/');
  return norm.startsWith(root) ? norm.slice(root.length) : norm.replace(/^\//, '');
}

function relFile(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts.slice(-2).join('/');
}
