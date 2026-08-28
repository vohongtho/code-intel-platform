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
 *   B.6  Cross-block dedup registry (canonical identity, not display name)
 *   B.7  Certainty-ranked evidence, allocation receipts, session-aware delivery
 */

import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { AnalysisBoundary, AnalysisCertainty, AnalysisCoverage, CodeEdge, CodeNode } from '../shared/index.js';
import { estimateTokens } from './token-counter.js';
import { enforceContextBudget, normalizeContextTokenBudget, trimTextToTokenBudget, type ContextBlockName } from './budget.js';
import { certaintyRank, omissionsFromReceipts, type ContextAllocationReceipt, type ContextOmission } from './receipt.js';
import { contentFingerprint, type ContextDeliverySession } from './session.js';
import { summarizeEdgeTrust } from '../query/trust.js';

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
  /** Repository directory used to look up relationship evidence for trust/coverage. */
  repoDir?: string;
  /** Per-workspace delivered-source memory — enables session-aware pointer back-references. */
  session?: ContextDeliverySession;
}

export interface ContextTrustSummary {
  certainty: AnalysisCertainty;
  boundaries: readonly AnalysisBoundary[];
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
  /** Compact evidence coverage across the calls/imports relationships considered. */
  coverage?: AnalysisCoverage;
  /** Compact trust summary (certainty + boundaries) for the same relationships. */
  trust?: ContextTrustSummary;
  /** Requested evidence that could not be delivered, with a structured reason. */
  omitted?: ContextOmission[];
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

/** Canonical identity for cross-block dedup/allocation — falls back to graph id pre-identity-v2. */
function canonicalId(node: CodeNode): string {
  return node.identityId ?? node.id;
}

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

// ── DedupeRegistry (B.6) — keyed by canonical identity, not display name ──────

class DedupeRegistry {
  private seenArtifacts = new Set<string>();
  private seenFilePaths = new Set<string>();
  private seenCallPairs = new Set<string>();
  private logicArtifacts = new Set<string>(); // B.4.2: artifacts referenced in LOGIC

  /** Returns full format on first mention, name-only on repeats. */
  formatSymbol(node: CodeNode, extra: string): string {
    const key = canonicalId(node);
    if (this.seenArtifacts.has(key)) return node.name;
    this.seenArtifacts.add(key);
    this.seenFilePaths.add(node.filePath);
    return extra;
  }

  hasArtifact(node: CodeNode): boolean {
    return this.seenArtifacts.has(canonicalId(node));
  }

  markCallPair(caller: CodeNode, callee: CodeNode): void {
    this.seenCallPairs.add(`${canonicalId(caller)}→${canonicalId(callee)}`);
  }

  hasCallPair(caller: CodeNode, callee: CodeNode): boolean {
    return this.seenCallPairs.has(`${canonicalId(caller)}→${canonicalId(callee)}`);
  }

  hasFilePath(fp: string): boolean {
    return this.seenFilePaths.has(fp);
  }

  /** Mark an artifact as referenced in the LOGIC block (B.4.2). */
  markInLogic(node: CodeNode): void {
    this.logicArtifacts.add(canonicalId(node));
  }

  /** Returns true only if the artifact was referenced in LOGIC (B.4.2). */
  isInLogic(node: CodeNode): boolean {
    return this.logicArtifacts.has(canonicalId(node));
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
      const formatted = dedup.formatSymbol(node, fullFmt);

      lines.push(useHeader ? `  ${formatted}` : formatted);
      void cluster; // reserved for future cluster-aware formatting
    }
  }

  return lines.join('\n');
}

// ── B.2 LOGIC block ───────────────────────────────────────────────────────────

function buildLogicBlock(
  nodes: CodeNode[],
  graph: KnowledgeGraph,
  dedup: DedupeRegistry,
): { text: string; edges: CodeEdge[] } {
  if (nodes.length === 0) return { text: '', edges: [] };

  const lines: string[] = ['[LOGIC]'];
  const consideredEdges: CodeEdge[] = [];

  // caller node id -> deduped callee nodes (by canonical id), ordered by certainty
  const nodeCallees = new Map<string, CodeNode[]>();
  const calleeUsage = new Map<string, number>(); // canonical callee id → distinct-caller count
  const calleeById = new Map<string, CodeNode>();

  for (const node of nodes) {
    const bestCertaintyForCallee = new Map<string, CodeEdge['certainty']>();
    const callees: CodeNode[] = [];
    const seenCalleeIds = new Set<string>();

    for (const edge of graph.findEdgesFrom(node.id)) {
      if (edge.kind !== 'calls') continue;
      const callee = graph.getNode(edge.target);
      if (!callee || callee.name === node.name) continue;
      consideredEdges.push(edge);
      const cid = canonicalId(callee);
      if (certaintyRank(edge.certainty) > certaintyRank(bestCertaintyForCallee.get(cid))) {
        bestCertaintyForCallee.set(cid, edge.certainty);
      }
      if (seenCalleeIds.has(cid)) continue;
      seenCalleeIds.add(cid);
      calleeById.set(cid, callee);
      callees.push(callee);
      calleeUsage.set(cid, (calleeUsage.get(cid) ?? 0) + 1);
    }

    // B.7: exact-certainty callees ranked first, then deterministic name/id tiebreak.
    callees.sort((a, b) =>
      certaintyRank(bestCertaintyForCallee.get(canonicalId(b))) - certaintyRank(bestCertaintyForCallee.get(canonicalId(a)))
      || a.name.localeCompare(b.name)
      || canonicalId(a).localeCompare(canonicalId(b)),
    );
    nodeCallees.set(node.id, callees);
  }

  // B.2.2: Find shared callees (≥ 3 distinct callers)
  const sharedCalleeIds = new Set<string>(
    [...calleeUsage.entries()].filter(([, cnt]) => cnt >= 3).map(([id]) => id),
  );

  // Emit shared callee note if any
  if (sharedCalleeIds.size > 0) {
    const sharedNames = [...sharedCalleeIds]
      .map((id) => calleeById.get(id)?.name)
      .filter((n): n is string => Boolean(n))
      .sort((a, b) => a.localeCompare(b));
    lines.push(`(all above → ${sharedNames.join(', ')})`);
  }

  for (const node of nodes) {
    const callees = (nodeCallees.get(node.id) ?? []).filter((c) => !sharedCalleeIds.has(canonicalId(c)));

    // Track call pairs for B.3.2
    for (const callee of callees) {
      dedup.markCallPair(node, callee);
    }

    if (callees.length === 0) continue;

    if (callees.length <= 5) {
      // B.2.1: single inline line
      for (const callee of callees) dedup.markInLogic(callee);
      lines.push(`${node.name} → ${callees.map((c) => c.name).join(', ')}`);
    } else {
      // > 5: multi-line, omit path for artifacts already in SUMMARY
      lines.push(`${node.name} →`);
      for (const callee of callees) {
        dedup.markInLogic(callee);
        if (dedup.hasArtifact(callee)) {
          lines.push(`  ${callee.name}`);
        } else {
          lines.push(`  ${callee.name} (${last2Segments(callee.filePath)})`);
        }
      }
    }
  }

  return { text: lines.length > 1 ? lines.join('\n') : '', edges: consideredEdges };
}

// ── B.3 RELATION block ────────────────────────────────────────────────────────

function buildRelationBlock(
  nodes: CodeNode[],
  graph: KnowledgeGraph,
  dedup: DedupeRegistry,
): { text: string; edges: CodeEdge[] } {
  if (nodes.length === 0) return { text: '', edges: [] };

  const lines: string[] = ['[RELATION]'];
  const consideredEdges: CodeEdge[] = [];

  for (const node of nodes) {
    const callerEdges = [...graph.findEdgesTo(node.id)].filter((e) => e.kind === 'calls');
    consideredEdges.push(...callerEdges);

    const bestByCallerId = new Map<string, { node: CodeNode; certainty: CodeEdge['certainty'] }>();
    for (const edge of callerEdges) {
      const callerNode = graph.getNode(edge.source);
      if (!callerNode) continue;
      const cid = canonicalId(callerNode);
      const existing = bestByCallerId.get(cid);
      if (!existing || certaintyRank(edge.certainty) > certaintyRank(existing.certainty)) {
        bestByCallerId.set(cid, { node: callerNode, certainty: edge.certainty });
      }
    }

    // B.7: exact-certainty callers ranked first, then deterministic name/id tiebreak.
    const callers = [...bestByCallerId.values()]
      .sort((a, b) =>
        certaintyRank(b.certainty) - certaintyRank(a.certainty)
        || a.node.name.localeCompare(b.node.name)
        || canonicalId(a.node).localeCompare(canonicalId(b.node)),
      )
      .map((entry) => entry.node);

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
        (c) => highBlast || !dedup.hasCallPair(c, node),
      );
      if (nonDupCallers.length > 0) {
        const top3 = nonDupCallers.slice(0, 3);
        const rest = nonDupCallers.length - 3;
        const callerStr = top3.map((c) => c.name).join(', ') + (rest > 0 ? ` (+${rest} more — use blast_radius for full list)` : '');
        lines.push(`${prefix}${node.name} ← ${callerStr}`);
      }
    }

    // Heritage — always one line (B.3.1)
    const heritage: string[] = [];
    if (extendsNodes.length > 0) heritage.push(`extends ${extendsNodes.join(', ')}`);
    if (implementsNodes.length > 0) heritage.push(`implements ${implementsNodes.join(' · ')}`);
    if (heritage.length > 0) lines.push(`${node.name}: ${heritage.join(' · ')}`);
  }

  return { text: lines.length > 1 ? lines.join('\n') : '', edges: consideredEdges };
}

// ── B.4 FOCUS CODE block ──────────────────────────────────────────────────────

interface FocusEntry {
  node: CodeNode;
  header: string;
  entry: string;
  demand: number;
  skipInLogic: boolean;
  missingSource: boolean;
  pointerEligible: boolean;
}

/** Classic max-min water-filling: smallest demands are satisfied first, freeing excess for larger ones. */
function waterFillAllowances(demands: readonly number[], totalBudget: number): number[] {
  const n = demands.length;
  const allowance = new Array<number>(n).fill(0);
  const order = demands.map((_, i) => i).sort((a, b) => demands[a] - demands[b] || a - b);
  let remaining = Math.max(0, totalBudget);
  let remainingCount = n;
  for (const idx of order) {
    const fairShare = remainingCount > 0 ? Math.floor(remaining / remainingCount) : 0;
    const grant = Math.max(0, Math.min(demands[idx], fairShare));
    allowance[idx] = grant;
    remaining -= grant;
    remainingCount--;
  }
  return allowance;
}

function buildFocusCodeBlock(
  seeds: SeedSymbol[],
  nodes: CodeNode[],
  dedup: DedupeRegistry,
  signatureOnlyThreshold: number,
  tokenBudget: number,
  session?: ContextDeliverySession,
): { text: string; truncated: boolean; receipts: ContextAllocationReceipt[] } {
  if (nodes.length === 0) return { text: '', truncated: false, receipts: [] };

  const lines: string[] = ['[FOCUS CODE]'];
  let usedTokens = estimateTokens('[FOCUS CODE]');
  let truncated = false;
  const receipts: ContextAllocationReceipt[] = [];

  const scoreOf = (node: CodeNode): number => seeds.find((s) => s.nodeId === node.id)?.refinedScore ?? 1.0;

  // ── Classify each node up front (B.4.2 skip / missing source / session pointer) ──
  const classified: FocusEntry[] = nodes.map((node) => {
    const content = node.content;
    const ml = content ? meaningfulLines(content).length : 0;
    const skipInLogic = ml <= 5 && dedup.isInLogic(node);
    const missingSource = !content;
    const pointerEligible = Boolean(session) && !skipInLogic && !missingSource
      && session!.lookup(canonicalId(node))?.contentFingerprint === contentFingerprint(content);

    const header = `// ${node.name} — ${last2Segments(node.filePath)}${node.startLine ? ':' + node.startLine : ''}`;
    let entry = '';
    if (!skipInLogic && !missingSource && !pointerEligible) {
      const score = scoreOf(node);
      if (score < signatureOnlyThreshold) {
        const sig = content?.split('\n').find((l) => l.trim().length > 0) ?? '';
        const sigLine = sig ? sig.trimEnd() + (sig.includes('{') ? ' ... }' : '') : '';
        entry = `${header}\n// (low relevance)\n${sigLine}`;
      } else {
        const { lines: snippet } = adaptiveSnippet(content);
        entry = `${header}\n\`\`\`\n${snippet}\n\`\`\``;
      }
    }

    return { node, header, entry, demand: entry ? estimateTokens(entry) : 0, skipInLogic, missingSource, pointerEligible };
  });

  // ── Prevent all-pointer responses: force the highest-priority node concrete ──
  const allPointerEligible = classified.length > 0 && classified.every((c) => c.pointerEligible || c.skipInLogic || c.missingSource);
  if (allPointerEligible) {
    const forced = classified.find((c) => c.pointerEligible);
    if (forced) {
      forced.pointerEligible = false;
      const score = scoreOf(forced.node);
      const content = forced.node.content;
      if (score < signatureOnlyThreshold) {
        const sig = content?.split('\n').find((l) => l.trim().length > 0) ?? '';
        const sigLine = sig ? sig.trimEnd() + (sig.includes('{') ? ' ... }' : '') : '';
        forced.entry = `${forced.header}\n// (low relevance)\n${sigLine}`;
      } else {
        const { lines: snippet } = adaptiveSnippet(content);
        forced.entry = `${forced.header}\n\`\`\`\n${snippet}\n\`\`\``;
      }
      forced.demand = estimateTokens(forced.entry);
    }
  }

  // ── Reserve fair-share allowances for the nodes competing for budget ──
  const competingIdx = classified
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !c.skipInLogic && !c.missingSource && !c.pointerEligible);
  const pointerCost = classified
    .filter((c) => c.pointerEligible)
    .reduce((sum, c) => sum + estimateTokens(`${c.header} (unchanged — already delivered in this session)`), 0);
  const remainingForCompetition = Math.max(0, tokenBudget - usedTokens - pointerCost);
  const demands = competingIdx.map(({ c }) => c.demand);
  const allowances = waterFillAllowances(demands, remainingForCompetition);
  const allowanceByIndex = new Map<number, number>();
  competingIdx.forEach(({ i }, k) => allowanceByIndex.set(i, allowances[k]));

  // ── Render in original node order ──
  for (let i = 0; i < classified.length; i++) {
    const { node, header, entry, skipInLogic, missingSource, pointerEligible } = classified[i];
    const artifactId = canonicalId(node);
    const score = scoreOf(node);

    if (skipInLogic) {
      receipts.push({ artifactId, name: node.name, namedByUser: true, relevanceScore: score, reservedTokens: 0, deliveredTokens: 0, deliveryMode: 'pointer' });
      continue;
    }

    if (missingSource) {
      receipts.push({ artifactId, name: node.name, namedByUser: true, relevanceScore: score, reservedTokens: 0, deliveredTokens: 0, deliveryMode: 'omitted', omissionReason: 'missing-source' });
      continue;
    }

    if (pointerEligible) {
      const pointerLine = `${header} (unchanged — already delivered in this session)`;
      const toks = estimateTokens(pointerLine);
      if (usedTokens + toks > tokenBudget) {
        truncated = true;
        receipts.push({ artifactId, name: node.name, namedByUser: true, relevanceScore: score, reservedTokens: 0, deliveredTokens: 0, deliveryMode: 'omitted', omissionReason: 'hard-limit' });
        continue;
      }
      lines.push(pointerLine);
      usedTokens += toks;
      receipts.push({ artifactId, name: node.name, namedByUser: true, relevanceScore: score, reservedTokens: toks, deliveredTokens: toks, deliveryMode: 'pointer' });
      continue;
    }

    const allowance = allowanceByIndex.get(i) ?? 0;
    const fullToks = estimateTokens(entry);

    if (allowance <= 0) {
      truncated = true;
      receipts.push({ artifactId, name: node.name, namedByUser: true, relevanceScore: score, reservedTokens: 0, deliveredTokens: 0, deliveryMode: 'omitted', omissionReason: 'budget' });
      continue;
    }

    if (fullToks <= allowance && usedTokens + fullToks <= tokenBudget) {
      lines.push(entry);
      usedTokens += fullToks;
      receipts.push({ artifactId, name: node.name, namedByUser: true, relevanceScore: score, reservedTokens: allowance, deliveredTokens: fullToks, deliveryMode: 'full' });
      continue;
    }

    const trimmed = trimTextToTokenBudget(entry, Math.min(allowance, Math.max(0, tokenBudget - usedTokens)));
    if (trimmed.text) {
      lines.push(trimmed.text);
      const toks = estimateTokens(trimmed.text);
      usedTokens += toks;
      truncated = true;
      receipts.push({ artifactId, name: node.name, namedByUser: true, relevanceScore: score, reservedTokens: allowance, deliveredTokens: toks, deliveryMode: 'window' });
    } else {
      truncated = true;
      receipts.push({ artifactId, name: node.name, namedByUser: true, relevanceScore: score, reservedTokens: allowance, deliveredTokens: 0, deliveryMode: 'omitted', omissionReason: 'budget' });
    }
  }

  return { text: lines.length > 1 ? lines.join('\n\n') : '', truncated, receipts };
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

  const logicResult = buildLogicBlock(nodes, graph, dedup);
  const logicFit = trimTextToTokenBudget(logicResult.text, Math.min(available, Math.floor(preset.logic * scale)));
  if (logicFit.truncated) truncatedBlocks.add('logic');
  available -= estimateTokens(logicFit.text);

  const relationResult = buildRelationBlock(nodes, graph, dedup);
  const relationFit = trimTextToTokenBudget(relationResult.text, Math.min(available, Math.floor(preset.relation * scale)));
  if (relationFit.truncated) truncatedBlocks.add('relation');
  available -= estimateTokens(relationFit.text);

  const focus = buildFocusCodeBlock(seeds, nodes, dedup, signatureOnlyThreshold, Math.max(0, available), options.session);
  if (focus.truncated) truncatedBlocks.add('focusCode');

  const enforced = enforceContextBudget({
    summary: summaryFit.text,
    logic: logicFit.text,
    relation: relationFit.text,
    focusCode: focus.text,
  }, maxTokens);
  for (const block of enforced.truncatedBlocks) truncatedBlocks.add(block);

  // Reconcile receipts against the final hard-budget pass: a receipt claiming
  // full/window delivery is downgraded if enforceContextBudget trimmed it away.
  const receipts = focus.receipts.map((receipt) => {
    if (receipt.deliveryMode !== 'full' && receipt.deliveryMode !== 'window') return receipt;
    const node = nodes.find((n) => canonicalId(n) === receipt.artifactId);
    const header = node ? `// ${node.name} — ${last2Segments(node.filePath)}${node.startLine ? ':' + node.startLine : ''}` : undefined;
    if (header && !enforced.blocks.focusCode.includes(header)) {
      return { ...receipt, deliveryMode: 'omitted' as const, omissionReason: 'hard-limit' as const, deliveredTokens: 0 };
    }
    return receipt;
  });

  // Session-aware delivery: record fingerprints for anything concretely delivered
  // this call so an unchanged repeat can become a pointer next time.
  if (options.session) {
    options.session.beginCall();
    for (const receipt of receipts) {
      if (receipt.deliveryMode !== 'full' && receipt.deliveryMode !== 'window') continue;
      const node = nodes.find((n) => canonicalId(n) === receipt.artifactId);
      if (!node?.content) continue;
      options.session.record(receipt.artifactId, contentFingerprint(node.content), node.content.length);
    }
  }

  const consideredEdges = [...logicResult.edges, ...relationResult.edges];
  const trustSummary = summarizeEdgeTrust(consideredEdges, options.repoDir, {
    truncated: truncatedBlocks.has('logic') || truncatedBlocks.has('relation'),
  });

  return {
    ...enforced.blocks,
    truncated: truncatedBlocks.size > 0,
    intent,
    maxTokens,
    blockTokens: enforced.blockTokens,
    truncatedBlocks: [...truncatedBlocks].sort(),
    coverage: trustSummary.coverage,
    trust: { certainty: trustSummary.certainty, boundaries: trustSummary.boundaries },
    omitted: omissionsFromReceipts(receipts),
  };
}
