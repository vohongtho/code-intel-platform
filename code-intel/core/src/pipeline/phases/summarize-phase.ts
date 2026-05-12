import crypto from 'node:crypto';
import type { Phase, PhaseResult, PipelineContext } from '../types.js';
import { governanceLogger } from '../../governance/llm-governance.js';
import type { LLMProvider, LLMConfig } from '../../llm/provider.js';
import { CircuitBreaker, withRetry } from '../../llm/retry.js';
import Logger from '../../shared/logger.js';

const SUMMARIZABLE_KINDS = new Set(['function', 'class', 'method', 'interface']);
const CHECKPOINT_INTERVAL = 10;
const DEFAULT_CONTEXT_WINDOW = 8192;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function checkEndpointReachable(endpoint: string): Promise<string | null> {
  try {
    await fetch(endpoint, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** chars/4 token estimate */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function codeHash(content: string | undefined | null): string {
  return crypto.createHash('sha256').update(content ?? '').digest('hex').slice(0, 16);
}

function trimSnippet(content: string | undefined | null, maxLines = 200): string {
  if (!content) return '';
  return content.split('\n').slice(0, maxLines).join('\n');
}

/**
 * Build a prompt that asks the LLM to summarize a SINGLE symbol.
 * Response is plain text — no JSON parsing needed.
 */
function buildSinglePrompt(kind: string, name: string, snippet: string): string {
  return (
    `Summarize the following ${kind} "${name}" in 1-2 sentences.\n` +
    `Return ONLY the summary text, no extra formatting or JSON.\n\n` +
    snippet
  );
}

// ─── DB flush ─────────────────────────────────────────────────────────────────

async function flushSummariesToDB(
  dbPath: string,
  nodes: Array<{ id: string; kind: string; metadata: Record<string, unknown> }>,
): Promise<void> {
  if (nodes.length === 0) return;
  try {
    const fsmod = await import('node:fs');
    if (!fsmod.default.existsSync(dbPath)) return;
    const { DbManager } = await import('../../storage/db-manager.js');
    const { NODE_TABLE_MAP } = await import('../../storage/schema.js');
    const db = new DbManager(dbPath);
    await db.init();
    for (const n of nodes) {
      const table = NODE_TABLE_MAP[n.kind as import('../../shared/index.js').NodeKind];
      if (!table) continue;
      const metaStr = JSON.stringify(n.metadata).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      try {
        await db.execute(
          `MATCH (x:${table} {id: '${n.id.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'}) SET x.metadata = '${metaStr}'`,
        );
      } catch { /* node may not exist yet */ }
    }
    db.close();
  } catch (err) {
    Logger.warn(`[summarize] checkpoint flush failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Phase ────────────────────────────────────────────────────────────────────

export function createSummarizePhase(providerOverride?: LLMProvider): Phase {
  return {
    name: 'summarize',
    dependencies: ['flow'],

    async execute(ctx: PipelineContext): Promise<PhaseResult> {
      const start = Date.now();

      if (!(ctx as PipelineContext & { summarize?: boolean }).summarize) {
        return { status: 'skipped', duration: 0, message: 'Summarize phase skipped (no --summarize flag)' };
      }

      const llmConfig: LLMConfig | undefined = (ctx as PipelineContext & { llmConfig?: LLMConfig }).llmConfig;

      // ── Create provider ────────────────────────────────────────────────────────
      let provider: LLMProvider;
      if (providerOverride) {
        provider = providerOverride;
        console.log(`  [summarize] Using injected provider (${provider.modelName})`);
      } else {
        try {
          const { createLLMProvider } = await import('../../llm/factory.js');
          const cfg = llmConfig ?? {};
          provider = await createLLMProvider(cfg);
          console.log(`  [summarize] ◈  Provider : ${cfg.provider ?? 'ollama'}`);
          console.log(`  [summarize]    Model    : ${provider.modelName}`);
          console.log(`  [summarize]    Endpoint : ${provider.endpoint}`);

          const reachErr = await checkEndpointReachable(provider.endpoint);
          if (reachErr) {
            const isOllama = (cfg.provider ?? 'ollama') === 'ollama';
            console.error(`\n  [summarize] ✗  Cannot reach LLM endpoint: ${provider.endpoint}`);
            console.error(`  [summarize]    Error: ${reachErr}`);
            if (isOllama) {
              console.error(`\n  ╔══════════════════════════════════════════════════════════════╗`);
              console.error(`  ║  Ollama is not running. To fix this, either:                 ║`);
              console.error(`  ║  1. Start Ollama:  ollama serve                              ║`);
              console.error(`  ║  2. Edit ~/.code-intel/config.json → "provider": "custom"   ║`);
              console.error(`  ╚══════════════════════════════════════════════════════════════╝\n`);
            } else {
              console.error(`\n  ╔══════════════════════════════════════════════════════════════╗`);
              console.error(`  ║  LLM endpoint is not reachable.                              ║`);
              console.error(`  ║  Check that your provider is running and baseUrl is correct. ║`);
              console.error(`  ╚══════════════════════════════════════════════════════════════╝\n`);
            }
            return { status: 'completed', duration: Date.now() - start, message: `Summarize skipped: endpoint unreachable (${provider.endpoint})` };
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          Logger.warn(`[summarize] LLM provider unavailable: ${msg}. Skipping summarize phase.`);
          console.error(`  [summarize] ✗  LLM provider unavailable: ${msg}`);
          return { status: 'completed', duration: Date.now() - start, message: `Summarize skipped: LLM API unavailable (${msg})` };
        }
      }

      const breaker  = new CircuitBreaker();
      const maxNodes = llmConfig?.maxNodesPerRun;
      const { graph } = ctx;

      // ── Step 1: Get context window from API (informational only) ──────────────
      let contextWindow = llmConfig?.contextWindow;
      if (!contextWindow) {
        try {
          const apiWindow = await provider.getContextWindow?.();
          if (apiWindow && apiWindow > 0) {
            contextWindow = apiWindow;
            console.log(`  [summarize] ◈  Context window: ${contextWindow} tokens (from model API)`);
          }
        } catch { /* ignore */ }
      } else {
        console.log(`  [summarize] ◈  Context window: ${contextWindow} tokens (from config)`);
      }
      if (!contextWindow) {
        contextWindow = DEFAULT_CONTEXT_WINDOW;
        console.log(`  [summarize] ◈  Context window: ${contextWindow} tokens (default)`);
      }

      // ── Step 2: Load prior summaries from DB ───────────────────────────────────
      const dbPath = ctx.dbPath;
      if (dbPath) {
        const fsmod = await import('node:fs');
        if (fsmod.default.existsSync(dbPath)) {
          try {
            const { DbManager } = await import('../../storage/db-manager.js');
            const { ALL_NODE_TABLES } = await import('../../storage/schema.js');
            const db = new DbManager(dbPath, true);
            await db.init();
            let loaded = 0; let skipped = 0; let dbRows = 0;
            for (const table of ALL_NODE_TABLES) {
              try {
                const rows = await db.query(`MATCH (n:${table}) RETURN n.id, n.metadata`);
                dbRows += rows.length;
                for (const row of rows) {
                  const id   = row['n.id']       as string | undefined;
                  const meta = row['n.metadata'] as string | undefined;
                  if (!id || !meta) continue;
                  const node = graph.getNode(id);
                  if (!node) continue;
                  try {
                    const parsed = JSON.parse(meta) as Record<string, unknown>;
                    if (parsed['summary'] && parsed['codeHash']) {
                      node.metadata = { ...(node.metadata ?? {}), ...parsed };
                      loaded++;
                    }
                  } catch { /* skip */ }
                }
              } catch { /* table may not exist yet */ }
            }
            db.close();
            for (const node of graph.allNodes()) {
              if (!SUMMARIZABLE_KINDS.has(node.kind)) continue;
              if (node.metadata?.summary && node.metadata?.codeHash === codeHash(node.content)) skipped++;
            }
            console.log(`  [summarize] ◈  DB: ${dbRows} rows scanned, ${loaded} summaries loaded, ${skipped} up-to-date (will skip)`);
          } catch (err) {
            Logger.warn(`[summarize] Could not load prior summaries from DB: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          console.log(`  [summarize] ◈  No prior DB found — all symbols will be summarized`);
        }
      }

      // ── Step 3: Collect candidates ────────────────────────────────────────────
      type Candidate = { id: string; kind: string; name: string; snippet: string; hash: string };
      const candidates: Candidate[] = [];
      for (const node of graph.allNodes()) {
        if (!SUMMARIZABLE_KINDS.has(node.kind)) continue;
        const hash            = codeHash(node.content);
        const existingHash    = node.metadata?.codeHash as string | undefined;
        const existingSummary = node.metadata?.summary  as string | undefined;
        if (existingSummary && existingHash === hash) continue;
        const snippet = trimSnippet(node.content);
        candidates.push({ id: node.id, kind: node.kind, name: node.name, snippet, hash });
        if (maxNodes !== undefined && candidates.length >= maxNodes) break;
      }

      const total        = candidates.length;
      let summarized     = 0;
      let errored        = 0;
      let totalPromptTok = 0;
      let totalCompTok   = 0;
      const phaseStart   = Date.now();
      let pendingFlush: Array<{ id: string; kind: string; metadata: Record<string, unknown> }> = [];

      console.log(`  [summarize] ${total} symbol(s) to summarize — 1 API call per symbol`);
      if (total === 0) {
        console.log(`  [summarize] Nothing to do — all nodes already have up-to-date summaries.`);
      }

      // ── SIGINT: save progress before exit ─────────────────────────────────────
      const sigintHandler = async () => {
        if (pendingFlush.length > 0 && dbPath) {
          console.log(`\n  [summarize] ⚡ Interrupted — flushing ${pendingFlush.length} summary(ies) to DB…`);
          await flushSummariesToDB(dbPath, pendingFlush);
          console.log(`  [summarize] ✓ Saved. Re-running with --summarize will resume from here.`);
        }
        process.exit(130);
      };
      process.once('SIGINT', sigintHandler);

      // ── Step 4: One API call per symbol ───────────────────────────────────────
      for (let i = 0; i < total; i++) {
        if (breaker.isOpen) {
          console.error(`  [summarize] ✗  Circuit breaker OPEN — stopping early.`);
          break;
        }

        const item      = candidates[i]!;
        const prompt    = buildSinglePrompt(item.kind, item.name, item.snippet);
        const approxTok = estimateTokens(prompt);
        const callStart = Date.now();

        console.log(`  [summarize] → [${i + 1}/${total}] ${item.kind} "${item.name}" (~${approxTok} tok)`);

        try {
          const result     = await withRetry(() => breaker.call(() => provider.summarize(prompt)));
          const durationMs = Date.now() - callStart;
          const summary    = result.text.trim();
          const totalTok   = result.promptTokens + result.completionTokens;
          const tokPerSec  = durationMs > 0 ? Math.round((totalTok / durationMs) * 1000) : 0;
          totalPromptTok  += result.promptTokens;
          totalCompTok    += result.completionTokens;

          const node = graph.getNode(item.id);
          if (node && summary) {
            node.metadata = {
              ...(node.metadata ?? {}),
              summary,
              summaryModel: provider.modelName,
              summaryAt:    Date.now(),
              codeHash:     item.hash,
            };
            summarized++;
            console.log(
              `    [${i + 1}/${total}] ✓ [${item.kind}] ${item.name}` +
              ` — "${summary.slice(0, 70)}${summary.length > 70 ? '…' : ''}"` +
              ` (${durationMs}ms · in:${result.promptTokens} out:${result.completionTokens} · ${tokPerSec} tok/s)`,
            );
            if (dbPath) {
              pendingFlush.push({ id: item.id, kind: item.kind, metadata: node.metadata as Record<string, unknown> });
            }
          } else {
            errored++;
            console.error(`    [${i + 1}/${total}] ✗ [${item.kind}] ${item.name} — empty response`);
          }

          governanceLogger.log({
            model: provider.modelName, userId: 'code-intel-cli', purpose: 'symbol-summary',
            promptTokens: result.promptTokens, responseTokens: result.completionTokens,
            durationMs, outcome: 'success',
          });

        } catch (err) {
          errored++;
          console.error(
            `    [${i + 1}/${total}] ✗ [${item.kind}] ${item.name}` +
            ` — ${err instanceof Error ? err.message : String(err)}`,
          );
          governanceLogger.log({
            model: provider.modelName, userId: 'code-intel-cli', purpose: 'symbol-summary',
            promptTokens: 0, responseTokens: 0,
            durationMs: Date.now() - callStart, outcome: 'error',
          });
        }

        ctx.onPhaseProgress?.('summarize', i + 1, total);

        // Checkpoint flush every CHECKPOINT_INTERVAL successes
        if (pendingFlush.length >= CHECKPOINT_INTERVAL && dbPath) {
          await flushSummariesToDB(dbPath, pendingFlush);
          pendingFlush = [];
        }
      }

      process.removeListener('SIGINT', sigintHandler);

      // Final DB flush
      if (pendingFlush.length > 0 && dbPath) {
        await flushSummariesToDB(dbPath, pendingFlush);
        pendingFlush = [];
      }

      const totalElapsed = Date.now() - phaseStart;
      const grandTotal   = totalPromptTok + totalCompTok;
      const avgTokPerSec = totalElapsed > 0 ? Math.round((grandTotal / totalElapsed) * 1000) : 0;
      const totalNodes   = [...graph.allNodes()].filter((n) => SUMMARIZABLE_KINDS.has(n.kind)).length;
      const msg = `${totalNodes} nodes · ${summarized} summaries generated · ${total} request(s)${errored > 0 ? ` · ${errored} errors` : ''}`;
      console.log(`  [summarize] Done — ${msg}`);
      console.log(`  [summarize] Tokens — in:${totalPromptTok} out:${totalCompTok} total:${grandTotal} · avg ${avgTokPerSec} tok/s`);

      return { status: 'completed', duration: Date.now() - start, message: msg };
    },
  };
}

export const summarizePhase: Phase = createSummarizePhase();
