import type { PipelineContext } from '../pipeline/types.js';

const DECISION_KEYWORDS = [
  /\bif\b/g,
  /\belse\s+if\b/g,
  /\bfor\b/g,
  /\bwhile\b/g,
  /\bdo\b/g,
  /\bcase\b/g,
  /\bcatch\b/g,
  /&&/g,
  /\|\|/g,
  /\?(?!\?)/g,  // ternary, not nullish coalescing
];

function countDecisionPoints(text: string): number {
  let count = 0;
  for (const pattern of DECISION_KEYWORDS) {
    const matches = text.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

export async function computeComplexityPhase(ctx: PipelineContext): Promise<void> {
  for (const node of ctx.graph.allNodes()) {
    if (node.kind !== 'function' && node.kind !== 'method') continue;

    const meta = node.metadata as Record<string, unknown> | undefined;
    if (!meta) continue;

    // Only compute if astText is available
    const astText = meta.astText as string | undefined;
    if (typeof astText !== 'string' || astText.length === 0) continue;

    const decisions = countDecisionPoints(astText);
    const cyclomatic = 1 + decisions;
    const cognitive = Math.ceil(cyclomatic * 1.3);

    // Store back into metadata
    (node.metadata as Record<string, unknown>).complexity = { cyclomatic, cognitive };
  }
}
