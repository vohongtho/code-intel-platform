/**
 * builder.ts — Part B: Context Builder Token Efficiency
 *
 * Builds a structured ContextDocument from seed symbols + graph in ≤ 50% of
 * baseline token cost vs v1.0.0's verbose format.
 *
 * Implements:
 *   B.1  Smart [SUMMARY] block  (one-line format + cluster grouping)
 *   B.2  Smart [LOGIC] block    (inline callees + shared callee collapse)
 *   B.3  Smart [RELATION] block (caller cap + logic↔relation dedup)
 *   B.4  Smart [FOCUS CODE]     (adaptive length + sig-only low relevance)
 *   B.5  Dynamic budget rebalancing + query-intent presets
 *   B.6  Cross-block dedup registry
 */

import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { CodeNode } from '../shared/index.js';
import { estimateTokens } from './token-counter.js';
import { enforceContextBudget, normalizeContextTokenBudget, trimTextToTokenBudget, type ContextBlockName } from './budget.js';

// ── Public types ───────────────────────────────────────────────────────────────

export type QueryIntent = 'code' | 'callers' | 'architecture' | 'auto';

export interface SeedSymbol {
  nodeId: string;
  /** BM25/vector relevance score (0–1+). Used for B.4.3 sig-only threshold. */
  refinedScore?: number;
}

export interface BuilderOptions {
  /** Max total tokens for the whole document (default: 6000). */
  maxTokens?: number;
  /** Governs per-block budget splits (default: 'auto'). */
  queryIntent?: QueryIntent;
  /** refinedScore below this → signature-only in FOCUS CODE (default: 0.3). */
  signatureOnlyThreshold?: number;
}

/** Rendered context document — one string per block. */
export interface ContextDocument {
  summary: string;
  logic: string;
  relation: string;
  focusCode: string;
  /** True when any block was shortened or omitted. */
  truncated: boolean;
  /** Detected or user-supplied intent (for observability). */
  intent: QueryIntent;
  /** Normalized hard limit applied to the complete document. */
  maxTokens?: number;
  /** Per-block token counts after all trimming. */
  blockTokens?: { summary: number; logic: number; relation: number; focusCode: number; total: number };
  /** Stable block names whose content was shortened or omitted. */
  truncatedBlocks?: ContextBlockName[];
}

// ── Budget presets (B.5.2) ─────────────────────────────────────────────────────

interface BudgetPreset { summary: number; logic: number; relation: number; focusCode: number }

const BUDGET_PRESETS: Record<QueryIntent, BudgetPreset> = {
  code:         { summary: 300,  logic: 400,  relation: 300,  focusCode: 5000 },
  callers:      { summary: 500,  logic: 300,  relation: 2500, focusCode: 700  },
  architecture: { summary: 1200, logic: 800,  relation: 800,  focusCode: 1200 },
  auto:         { summary: 800,  logic: 600,  relation: 500,  focusCode: 1500 },
};

// ── Query-intent detection (B.5.2) ────────────────────────────────────────────

export function detectQueryIntent(question: string): QueryIntent {
  const q = question.toLowerCase();
  if (/\b(show|code|implement|source|how is written|function body|method body)\b/.test(q)) return 'code';
  if (/\b(who calls|callers?|depends on|blast radius|impact|upstream)\b/.test(q)) return 'callers';
  if (/\b(architecture|overview|structure|design|how is built|system)\b/.test(q)) return 'architecture';
  return 'auto';
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Last 2 path segments: `src/auth/user.ts` → `auth/user.ts` */
function last2Segments(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

/** First sentence, max 15 words. */
function firstSentence(text: string | undefined): string {
  if (!text) return '';
  const sentence = text.split(/[.!?]/)[0]?.trim() ?? '';
  const words = sentence.split(/\s+/);
  return words.slice(0, 15).join(' ');
}

/** Get cluster name for a node from graph edges. */
function getCluster(graph: KnowledgeGraph, nodeId: string): string | undefined {
  for (const edge of graph.findEdgesFrom(nodeId)) {
    if (edge.kind === 'belongs_to') return graph.getNode(edge.target)?.name;
  }
  return undefined;
}

/** Directory of a filePath (last segment removed). */
function dirOf(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(0, -1).join('/') || '.';
}

/** Count meaningful (non-blank, non-comment-only) lines. */
function meaningfulLines(content: string): string[] {
  return content.split('\n').filter((l) => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('#');
  });
}

/** Adaptive snippet: ≤10 meaningful → all, 11–25 → 25 raw, >25 → 40 raw. */
function adaptiveSnippet(content: string | undefined): { lines: string; truncated: boolean } {
  if (!content) return { lines: '', truncated: false };
  const stripped = content.replace(/^\n+|\n+$/g, ''); // trim leading/trailing blank
  const rawLines = stripped.split('\n');
  const ml = meaningfulLines(stripped).length;
  if (ml <= 10) return { lines: stripped, truncated: false };
  if (ml <= 25) {
    const out = rawLines.slice(0, 25);
    const truncated = rawLines.length > 25;
    return { lines: out.join('\n') + (truncated ? '\n// ...' : ''), truncated };
  }
  const out = rawLines.slice(0, 40);
  const remaining = rawLines.length - 40;
  return {
    lines: out.join('\n') + (remaining > 0 ? `\n// ... (${remaining} more lines)` : ''),
    truncated: remaining > 0,
  };
}

// ── DedupeRegistry (B.6) ──────────────────────────────────────────────────────

class DedupeRegistry {
  private seenSymbols = new Set<string>();
  private seenFilePaths = new Set<string>();
  private seenCallPairs = new Set<string>();
  private logicSymbols = new Set<string>(); // B.4.2: symbols referenced in LOGIC

  /** Returns full format on first mention, name-only on repeats. */
  formatSymbol(name: string, filePath: string, extra: string): string {
    const key = name;
    if (this.seenSymbols.has(key)) return name;
    this.seenSymbols.add(key);
    this.seenFilePaths.add(filePath);
    return extra;
  }

  hasSymbol(name: string): boolean {
    return this.seenSymbols.has(name);
  }

  markCallPair(caller: string, callee: string): void {
    this.seenCallPairs.add(`${caller}→${callee}`);
  }

  hasCallPair(caller: string, callee: string): boolean {
    return this.seenCallPairs.has(`${caller}→${callee}`);
  }

  hasFilePath(fp: string): boolean {
    return this.seenFilePaths.has(fp);
  }

  /** Mark a symbol as referenced in the LOGIC block (B.4.2). */
  markInLogic(name: string): void {
    this.logicSymbols.add(name);
  }

  /** Returns true only if symbol was referenced in LOGIC (B.4.2). */
  isInLogic(name: string): boolean {
    return this.logicSymbols.has(name);
  }
}

// ── B.1 SUMMARY block ─────────────────────────────────────────────────────────

function buildSummaryBlock(
  nodes: CodeNode[],
  graph: KnowledgeGraph,
  dedup: DedupeRegistry,
): string {
  if (nodes.length === 0) return '';

  // B.1.2: Group by directory when ≥ 3 share the same dir
  const byDir = new Map<string, CodeNode[]>();
  for (const node of nodes) {
    const dir = dirOf(node.filePath);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(node);
  }

  const lines: string[] = ['[SUMMARY]'];

  for (const [dir, group] of byDir) {
    const useHeader = group.length >= 3;
    if (useHeader) lines.push(`${dir}/:`);

    for (const node of group) {
      const summary = firstSentence(node.metadata?.['summary'] as string | undefined);
      const callerCount = [...graph.findEdgesTo(node.id)].filter((e) => e.kind === 'calls').length;
      const cluster = getCluster(graph, node.id);

      // Badges
      const badges: string[] = [];
      if (callerCount >= 10) badges.push('⚠');            // god node heuristic
      if (callerCount === 0) badges.push('👻');            // orphan
      const badgeStr = badges.join('');

      // Path: last 2 segments, omit cluster if same as dir
      const path2 = last2Segments(node.filePath);
      const line = node.startLine ? `:${node.startLine}` : '';

      const fullFmt = `${node.name} [${node.kind}] ${path2}${line}${badgeStr ? ' ' + badgeStr : ''}${summary ? ' — ' + summary : ''}`;
      const formatted = dedup.formatSymbol(node.name, node.filePath, fullFmt);

      lines.push(useHeader ? `  ${formatted}` : formatted);
    }
  }

  return lines.join('\n');
}

// ── B.2 LOGIC block ───────────────────────────────────────────────────────────

function buildLogicBlock(
  nodes: CodeNode[],
  graph: KnowledgeGraph,
  dedup: DedupeRegistry,
): string {
  if (nodes.length === 0) return '';

  const lines: string[] = ['[LOGIC]'];

  // Collect all callees per node
  const nodeCallees = new Map<string, string[]>();
  const calleeUsage = new Map<string, number>(); // callee name → how many nodes use it

  for (const node of nodes) {
    const callees: string[] = [];
    for (const edge of graph.findEdgesFrom(node.id)) {
      if (edge.kind === 'calls') {
        const callee = graph.getNode(edge.target);
        if (callee && callee.name !== node.name) {
          callees.push(callee.name);
          calleeUsage.set(callee.name, (calleeUsage.get(callee.name) ?? 0) + 1);
        }
      }
    }
    nodeCallees.set(node.id, [...new Set(callees)]);
  }

  // B.2.2: Find shared callees (≥ 3 nodes)
  const sharedCallees = new Set<string>(
    [...calleeUsage.entries()].filter(([, cnt]) => cnt >= 3).map(([name]) => name),
  );

  // Emit shared callee note if any
  if (sharedCallees.size > 0) {
    lines.push(`(all above → ${[...sharedCallees].join(', ')})`);
  }

  for (const node of nodes) {
    const callees = (nodeCallees.get(node.id) ?? []).filter((c) => !sharedCallees.has(c));

    // Track call pairs for B.3.2
    for (const callee of callees) {
      dedup.markCallPair(node.name, callee);
    }

    if (callees.length === 0) continue;

    if (callees.length <= 5) {
      // B.2.1: single inline line
      for (const callee of callees) dedup.markInLogic(callee);
      lines.push(`${node.name} → ${callees.join(', ')}`);
    } else {
      // > 5: multi-line, omit path for symbols already in SUMMARY
      lines.push(`${node.name} →`);
      for (const callee of callees) {
        dedup.markInLogic(callee);
        if (dedup.hasSymbol(callee)) {
          lines.push(`  ${callee}`);
        } else {
          // find file
          const calleeNode = [...graph.allNodes()].find((n) => n.name === callee);
          const path = calleeNode ? ` (${last2Segments(calleeNode.filePath)})` : '';
          lines.push(`  ${callee}${path}`);
        }
      }
    }
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

// ── B.3 RELATION block ────────────────────────────────────────────────────────

function buildRelationBlock(
  nodes: CodeNode[],
  graph: KnowledgeGraph,
  dedup: DedupeRegistry,
): string {
  if (nodes.length === 0) return '';

  const lines: string[] = ['[RELATION]'];

  for (const node of nodes) {
    const callers = [...graph.findEdgesTo(node.id)]
      .filter((e) => e.kind === 'calls')
      .map((e) => graph.getNode(e.source)?.name)
      .filter((n): n is string => Boolean(n));

    const extendsNodes = [...graph.findEdgesFrom(node.id)]
      .filter((e) => e.kind === 'extends')
      .map((e) => graph.getNode(e.target)?.name)
      .filter((n): n is string => Boolean(n));

    const implementsNodes = [...graph.findEdgesFrom(node.id)]
      .filter((e) => e.kind === 'implements')
      .map((e) => graph.getNode(e.target)?.name)
      .filter((n): n is string => Boolean(n));

    // B.3.1: Cap callers
    const highBlast = callers.length >= 5;
    const prefix = highBlast ? '⚡ ' : '';

    if (callers.length > 0) {
      // B.3.2: Skip entries already expressed in LOGIC (unless high blast radius)
      const nonDupCallers = callers.filter(
        (c) => highBlast || !dedup.hasCallPair(c, node.name),
      );
      if (nonDupCallers.length > 0) {
        const top3 = nonDupCallers.slice(0, 3);
        const rest = nonDupCallers.length - 3;
        const callerStr = top3.join(', ') + (rest > 0 ? ` (+${rest} more — use blast_radius for full list)` : '');
        lines.push(`${prefix}${node.name} ← ${callerStr}`);
      }
    }

    // Heritage — always one line (B.3.1)
    const heritage: string[] = [];
    if (extendsNodes.length > 0) heritage.push(`extends ${extendsNodes.join(', ')}`);
    if (implementsNodes.length > 0) heritage.push(`implements ${implementsNodes.join(' · ')}`);
    if (heritage.length > 0) lines.push(`${node.name}: ${heritage.join(' · ')}`);
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

// ── B.4 FOCUS CODE block ──────────────────────────────────────────────────────

function buildFocusCodeBlock(
  seeds: SeedSymbol[],
  nodes: CodeNode[],
  dedup: DedupeRegistry,
  signatureOnlyThreshold: number,
  tokenBudget: number,
): { text: string; truncated: boolean } {
  if (nodes.length === 0) return { text: '', truncated: false };

  const lines: string[] = ['[FOCUS CODE]'];
  let usedTokens = estimateTokens('[FOCUS CODE]');
  let truncated = false;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const seed = seeds.find((s) => s.nodeId === node.id);
    const score = seed?.refinedScore ?? 1.0;
    const content = node.content;

    // B.4.2: Skip short symbols already referenced in LOGIC
    const ml = content ? meaningfulLines(content).length : 0;
    if (ml <= 5 && dedup.isInLogic(node.name)) continue;

    const header = `// ${node.name} — ${last2Segments(node.filePath)}${node.startLine ? ':' + node.startLine : ''}`;

    // B.4.3: Signature-only for low relevance
    if (score < signatureOnlyThreshold) {
      const sig = content?.split('\n').find((l) => l.trim().length > 0) ?? '';
      const sigLine = sig ? sig.trimEnd() + (sig.includes('{') ? ' ... }' : '') : '';
      const entry = `${header}\n// (low relevance)\n${sigLine}`;
      const toks = estimateTokens(entry);
      if (usedTokens + toks > tokenBudget) { truncated = true; break; }
      lines.push(entry);
      usedTokens += toks;
      continue;
    }

    // Full adaptive snippet
    const { lines: snippet, truncated: snipTruncated } = adaptiveSnippet(content);
    const entry = `${header}\n\`\`\`\n${snippet}\n\`\`\``;
    const toks = estimateTokens(entry);
    if (usedTokens + toks > tokenBudget) { truncated = true; break; }
    lines.push(entry);
    usedTokens += toks;
    if (snipTruncated) truncated = true;
  }

  return { text: lines.length > 1 ? lines.join('\n\n') : '', truncated };
}

// ── Main build() ──────────────────────────────────────────────────────────────

export function build(
  seeds: SeedSymbol[],
  graph: KnowledgeGraph,
  options: BuilderOptions = {},
): ContextDocument {
  const maxTokens = normalizeContextTokenBudget(options.maxTokens);
  const signatureOnlyThreshold = options.signatureOnlyThreshold ?? 0.3;
  const intent: QueryIntent = options.queryIntent ?? 'auto';
  const preset = BUDGET_PRESETS[intent];
  const nodes = seeds.map((seed) => graph.getNode(seed.nodeId)).filter((node): node is CodeNode => node !== undefined);
  const dedup = new DedupeRegistry();
  const truncatedBlocks = new Set<ContextBlockName>();
  let available = maxTokens;
  const presetTotal = preset.summary + preset.logic + preset.relation + preset.focusCode;
  const scale = Math.min(1, maxTokens / presetTotal);

  const summaryFit = trimTextToTokenBudget(buildSummaryBlock(nodes, graph, dedup), Math.min(available, Math.floor(preset.summary * scale)));
  if (summaryFit.truncated) truncatedBlocks.add('summary');
  available -= estimateTokens(summaryFit.text);

  const logicFit = trimTextToTokenBudget(buildLogicBlock(nodes, graph, dedup), Math.min(available, Math.floor(preset.logic * scale)));
  if (logicFit.truncated) truncatedBlocks.add('logic');
  available -= estimateTokens(logicFit.text);

  const relationFit = trimTextToTokenBudget(buildRelationBlock(nodes, graph, dedup), Math.min(available, Math.floor(preset.relation * scale)));
  if (relationFit.truncated) truncatedBlocks.add('relation');
  available -= estimateTokens(relationFit.text);

  const focus = buildFocusCodeBlock(seeds, nodes, dedup, signatureOnlyThreshold, Math.max(0, available));
  if (focus.truncated) truncatedBlocks.add('focusCode');
  const enforced = enforceContextBudget({
    summary: summaryFit.text,
    logic: logicFit.text,
    relation: relationFit.text,
    focusCode: focus.text,
  }, maxTokens);
  for (const block of enforced.truncatedBlocks) truncatedBlocks.add(block);
  return {
    ...enforced.blocks,
    truncated: truncatedBlocks.size > 0,
    intent,
    maxTokens,
    blockTokens: enforced.blockTokens,
    truncatedBlocks: [...truncatedBlocks].sort(),
  };
}
