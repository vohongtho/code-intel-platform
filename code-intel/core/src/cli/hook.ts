#!/usr/bin/env node
/**
 * hook.ts — Tiny standalone hook entry point.
 *
 * This is compiled to dist/cli/hook.js and published as the `code-intel-hook`
 * binary. It imports ONLY hook-rewriter.ts — nothing else.
 *
 * Why separate from main.ts:
 *   main.ts bundles 714KB of OTel, DB, graph, pipeline code.
 *   Even with IS_HOOK_MODE guards, Node.js still parses the entire bundle
 *   (~850ms startup). This hook binary is ~5KB and starts in ~50ms.
 *
 * This binary is installed into ~/.claude/settings.json by `code-intel setup`:
 *   { "command": "code-intel-hook claude" }
 */

import { runClaudeHook, runCopilotHook, runCursorHook, runGeminiHook } from './hook-rewriter.js';

const agent = process.argv[2];

if (!agent) {
  process.stderr.write('[code-intel-hook] Usage: code-intel-hook <agent>\n');
  process.stderr.write('  Agents: claude, copilot, cursor, gemini\n');
  process.exit(0);
}

switch (agent) {
  case 'claude':
    runClaudeHook();
    break;
  case 'copilot':
    runCopilotHook();
    break;
  case 'cursor':
    runCursorHook();
    break;
  case 'gemini':
    runGeminiHook();
    break;
  default:
    process.stderr.write(`[code-intel-hook] Unknown agent: ${agent}\n`);
    process.exit(0);
}
