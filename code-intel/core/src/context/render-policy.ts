/**
 * render-policy.ts — assigns one source render mode per selected artifact.
 *
 *   full       central implementation, complete source
 *   snippet    focused implementation, adaptive window
 *   signature  supporting declaration only
 *   skeleton   syntax-aware compressed structure (capability-gated)
 *   reference  identical source already delivered in this session
 *
 * The plan is computed up front (skeletonization is async) and handed to the
 * synchronous context builder. The builder still owns the hard token budget,
 * trust, coverage and omission receipts.
 */

import type { CodeNode } from '../shared/index.js';
import { estimateTokens } from './token-counter.js';
import { contentFingerprint, type ContextDeliverySession } from './session.js';
import { skeletonize, type SkeletonUnsupportedReason } from './skeletonizer.js';

export type ContextRenderMode = 'full' | 'snippet' | 'signature' | 'skeleton' | 'reference';
export type CompressionPolicy = 'auto' | 'none' | 'aggressive';
export type RenderRole = 'central' | 'focus' | 'supporting';

export const RENDER_POLICY_VERSION = 'render-policy-v1';

/** Relative budget weight per mode, used to split a token budget across decisions. */
export const RENDER_MODE_WEIGHTS: Readonly<Record<ContextRenderMode, number>> = Object.freeze({
  full: 5,
  snippet: 3,
  skeleton: 2,
  signature: 1,
  reference: 0.2,
});

export interface RenderCandidate {
  node: CodeNode;
  /** Task relevance in 0..1+, higher is more relevant. */
  relevance: number;
}

export interface RenderDecision {
  nodeId: string;
  /** Canonical identity (identityId, falling back to graph id). */
  artifactId: string;
  mode: ContextRenderMode;
  role: RenderRole;
  tokenAllocation: number;
  reason: string;
  /** Mode that was wanted before a capability/freshness fallback. */
  requestedMode?: ContextRenderMode;
  /** Present when the decision degraded: names the capability boundary. */
  boundary?: string;
  /** Pre-rendered skeleton text (only for mode 'skeleton'). */
  skeletonText?: string;
  /** True when body detail was deliberately left out (skeleton/signature). */
  bodyOmitted: boolean;
}

export interface ContextRenderPlan {
  version: typeof RENDER_POLICY_VERSION;
  compression: CompressionPolicy;
  decisions: ReadonlyMap<string, RenderDecision>;
}

export interface PlanRenderInput {
  candidates: readonly RenderCandidate[];
  maxTokens: number;
  compression?: CompressionPolicy;
  session?: ContextDeliverySession;
  indexIdentity?: string;
  /** Number of nodes rendered with full source (default 1). */
  centralCount?: number;
  /** Number of nodes rendered with a snippet after the central ones (default 1). */
  focusCount?: number;
}

/** Everything past the central + focus nodes is supporting and gets skeleton/signature rendering. */
export const DEFAULT_FOCUS_COUNT = 1;
const SHORT_BODY_LINES = 8;
const FUNCTION_KINDS = new Set(['function', 'method', 'constructor']);

export function canonicalArtifactId(node: CodeNode): string {
  return node.identityId ?? node.id;
}

function meaningfulLineCount(content: string): number {
  return content.split('\n').filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('#');
  }).length;
}

function compareCandidates(a: RenderCandidate, b: RenderCandidate): number {
  return b.relevance - a.relevance
    || a.node.name.localeCompare(b.node.name)
    || canonicalArtifactId(a.node).localeCompare(canonicalArtifactId(b.node));
}

function roleFor(index: number, central: number, focus: number): RenderRole {
  if (index < central) return 'central';
  if (index < central + focus) return 'focus';
  return 'supporting';
}

interface Draft {
  candidate: RenderCandidate;
  role: RenderRole;
  mode: ContextRenderMode;
  reason: string;
  requestedMode?: ContextRenderMode;
  boundary?: string;
  skeletonText?: string;
}

async function decideSupporting(candidate: RenderCandidate, role: RenderRole, compression: CompressionPolicy): Promise<Draft> {
  const { node } = candidate;
  const content = node.content ?? '';
  const short = meaningfulLineCount(content) <= SHORT_BODY_LINES;
  if (short) return { candidate, role, mode: 'snippet', reason: 'short-body-kept-whole' };
  if (!FUNCTION_KINDS.has(node.kind)) {
    return { candidate, role, mode: 'signature', reason: 'supporting-declaration', requestedMode: 'skeleton', boundary: 'skeleton-unsupported:node-kind-unsupported' };
  }
  const skeleton = await skeletonize({ content, filePath: node.filePath, nodeKind: node.kind });
  if (skeleton.status === 'ok') {
    return {
      candidate,
      role,
      mode: 'skeleton',
      reason: compression === 'aggressive' ? 'aggressive-compression' : 'supporting-implementation-compressed',
      skeletonText: skeleton.text,
    };
  }
  return {
    candidate,
    role,
    mode: 'signature',
    reason: 'supporting-declaration',
    requestedMode: 'skeleton',
    boundary: `skeleton-unsupported:${skeleton.reason satisfies SkeletonUnsupportedReason}`,
  };
}

/**
 * Plan one render decision per candidate. Deterministic for identical input;
 * a fresh session reference always wins, a stale one never does.
 */
export async function planRender(input: PlanRenderInput): Promise<ContextRenderPlan> {
  const compression = input.compression ?? 'auto';
  const central = Math.max(1, input.centralCount ?? 1);
  const focus = Math.max(0, input.focusCount ?? DEFAULT_FOCUS_COUNT);
  const sorted = [...input.candidates].sort(compareCandidates);

  const drafts: Draft[] = [];
  for (const [index, candidate] of sorted.entries()) {
    const role = compression === 'aggressive' && index >= central ? 'supporting' : roleFor(index, central, focus);
    const { node } = candidate;
    const artifactId = canonicalArtifactId(node);

    if (node.content && input.session?.isFresh(artifactId, contentFingerprint(node.content), input.indexIdentity)) {
      drafts.push({ candidate, role, mode: 'reference', reason: 'unchanged-in-session' });
      continue;
    }
    if (compression === 'none') {
      drafts.push({ candidate, role, mode: role === 'central' ? 'full' : 'snippet', reason: 'compression-disabled' });
      continue;
    }
    if (role === 'central') {
      drafts.push({ candidate, role, mode: 'full', reason: 'central-to-task' });
    } else if (role === 'focus') {
      drafts.push({ candidate, role, mode: 'snippet', reason: 'focused-implementation' });
    } else {
      drafts.push(await decideSupporting(candidate, role, compression));
    }
  }

  const totalWeight = drafts.reduce((sum, draft) => sum + RENDER_MODE_WEIGHTS[draft.mode], 0) || 1;
  const decisions = new Map<string, RenderDecision>();
  for (const draft of drafts) {
    const { node } = draft.candidate;
    const demand = draft.mode === 'skeleton'
      ? estimateTokens(draft.skeletonText ?? '')
      : estimateTokens(node.content ?? '');
    const share = Math.floor((input.maxTokens * RENDER_MODE_WEIGHTS[draft.mode]) / totalWeight);
    decisions.set(node.id, {
      nodeId: node.id,
      artifactId: canonicalArtifactId(node),
      mode: draft.mode,
      role: draft.role,
      tokenAllocation: draft.mode === 'reference' ? 0 : Math.min(share, demand),
      reason: draft.reason,
      requestedMode: draft.requestedMode,
      boundary: draft.boundary,
      skeletonText: draft.skeletonText,
      bodyOmitted: draft.mode === 'skeleton' || draft.mode === 'signature',
    });
  }
  return { version: RENDER_POLICY_VERSION, compression, decisions };
}

/** Mode distribution for observability counters. */
export function renderModeDistribution(plan: ContextRenderPlan): Record<ContextRenderMode, number> {
  const counts: Record<ContextRenderMode, number> = { full: 0, snippet: 0, signature: 0, skeleton: 0, reference: 0 };
  for (const decision of plan.decisions.values()) counts[decision.mode] += 1;
  return counts;
}
