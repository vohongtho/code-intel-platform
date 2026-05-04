import crypto from 'node:crypto';
import type { Phase, PhaseResult, PipelineContext } from '../types.js';
import { governanceLogger } from '../../governance/llm-governance.js';
import type { LLMProvider, LLMConfig } from '../../llm/provider.js';
import { CircuitBreaker, withRetry } from '../../llm/retry.js';
import Logger from '../../shared/logger.js';

const SUMMARIZABLE_KINDS = new Set(['function', 'class', 'method', 'interface']);
const MAX_SNIPPET_LINES  = 200;

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(kind: string, name: string, snippet: string): string {
  return `Summarize this ${kind} named '${name}' in 1-2 sentences. Code:\n${snippet}`;
}

function codeHash(content: string | undefined | null): string {
  return crypto.createHash('sha256').update(content ?? '').digest('hex').slice(0, 16);
}

function trimSnippet(content: string | undefined | null): string {
  if (!content) return '';
  const lines = content.split('\n');
  return lines.slice(0, MAX_SNIPPET_LINES).join('\n');
}

// ─── Phase ────────────────────────────────────────────────────────────────────

/**
 * Create the summarize phase.
 *
 * @param providerOverride  Optional LLMProvider — used by tests to inject a
 *                          fake provider without touching the factory module.
 */
export function createSummarizePhase(providerOverride?: LLMProvider): Phase {
  return {
    name: 'summarize',
    dependencies: ['flow'],

    async execute(ctx: PipelineContext): Promise<PhaseResult> {
      const start = Date.now();

      // Phase is a no-op unless opt-in flag is set
      if (!(ctx as PipelineContext & { summarize?: boolean }).summarize) {
        return { status: 'skipped', duration: 0, message: 'Summarize phase skipped (no --summarize flag)' };
      }

      const llmConfig: LLMConfig | undefined = (ctx as PipelineContext & { llmConfig?: LLMConfig }).llmConfig;

      let provider: LLMProvider;
      if (providerOverride) {
        provider = providerOverride;
      } else {
        try {
          const { createLLMProvider } = await import('../../llm/factory.js');
          provider = await createLLMProvider(llmConfig ?? {});
        } catch (err) {
          // Epic 6: LLM API unavailable → skip summarize; analysis still completes
          const msg = err instanceof Error ? err.message : String(err);
          Logger.warn(`[summarize] LLM provider unavailable: ${msg}. Skipping summarize phase.`);
          return { status: 'completed', duration: Date.now() - start, message: `Summarize skipped: LLM API unavailable (${msg})` };
        }
      }

      const breaker    = new CircuitBreaker();
      const batchSize  = llmConfig?.batchSize      ?? 20;
      const maxNodes   = llmConfig?.maxNodesPerRun;
      const { graph }  = ctx;

      // Collect candidates
      const candidates: { id: string; kind: string; name: string; snippet: string; hash: string }[] = [];
      for (const node of graph.allNodes()) {
        if (!SUMMARIZABLE_KINDS.has(node.kind)) continue;

        const hash             = codeHash(node.content);
        const existingHash     = node.metadata?.codeHash as string | undefined;
        const existingSummary  = node.metadata?.summary  as string | undefined;

        if (existingSummary && existingHash === hash) continue;

        candidates.push({
          id:      node.id,
          kind:    node.kind,
          name:    node.name,
          snippet: trimSnippet(node.content),
          hash,
        });

        if (maxNodes !== undefined && candidates.length >= maxNodes) break;
      }

      const total = candidates.length;
      let summarized = 0;
      let errored    = 0;

      for (let i = 0; i < total; i += batchSize) {
        if (breaker.isOpen) break;

        const batch = candidates.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (c) => {
            const prompt       = buildPrompt(c.kind, c.name, c.snippet);
            const promptTokens = Math.ceil(prompt.length / 4);
            const callStart    = Date.now();

            try {
              const summary = await withRetry(() => breaker.call(() => provider.summarize(prompt)));
              const responseTokens = Math.ceil(summary.length / 4);

              const node = graph.getNode(c.id);
              if (node) {
                node.metadata = {
                  ...(node.metadata ?? {}),
                  summary,
                  summaryModel: provider.modelName,
                  summaryAt:    Date.now(),
                  codeHash:     c.hash,
                };
              }

              summarized++;

              governanceLogger.log({
                model:          provider.modelName,
                userId:         'code-intel-cli',
                purpose:        'symbol-summary',
                promptTokens,
                responseTokens,
                durationMs:     Date.now() - callStart,
                outcome:        'success',
              });
            } catch (err) {
              errored++;
              governanceLogger.log({
                model:          provider.modelName,
                userId:         'code-intel-cli',
                purpose:        'symbol-summary',
                promptTokens,
                responseTokens: 0,
                durationMs:     Date.now() - callStart,
                outcome:        'error',
                errorCode:      err instanceof Error ? err.message.slice(0, 80) : String(err),
              });
            }
          }),
        );

        ctx.onPhaseProgress?.('summarize', Math.min(i + batchSize, total), total);
      }

      const totalNodes = [...graph.allNodes()].filter((n) => SUMMARIZABLE_KINDS.has(n.kind)).length;
      const msg = `${totalNodes} nodes · ${summarized} summaries generated${errored > 0 ? ` · ${errored} errors` : ''}`;

      return {
        status:   'completed',
        duration: Date.now() - start,
        message:  msg,
      };
    },
  };
}

export const summarizePhase: Phase = createSummarizePhase();
