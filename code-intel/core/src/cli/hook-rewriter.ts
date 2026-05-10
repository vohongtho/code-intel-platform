/**
 * hook-rewriter.ts
 *
 * Single source of truth for all command rewrite rules.
 * Equivalent to RTK's src/discover/rules.rs + src/discover/registry.rs.
 *
 * Called by:
 *   - `code-intel rewrite <cmd>` → exit 0 (match) | exit 1 (no match)
 *   - `code-intel hook claude`   → reads stdin PreToolUse JSON, writes response JSON
 *
 * ZERO heavy imports — this module must load in <50ms.
 * No DB, no graph, no pipeline, no config, no filesystem access.
 */

import process from 'node:process';

// ─── Source file extensions ───────────────────────────────────────────────────
// Only these are worth inspecting via code-intel inspect.
// All other file types (config, docs, logs, data) pass through unchanged.

const SOURCE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'pyi',
  'rs',
  'go',
  'java', 'kt', 'kts',
  'rb',
  'cs',
  'cpp', 'cc', 'cxx', 'c', 'h', 'hpp',
  'swift',
  'scala',
  'php',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Regex metacharacters that indicate a true regex pattern, not a symbol name.
 * If a grep/rg search term contains any of these, we don't rewrite.
 */
const REGEX_META_RE = /[.*+?^${}()|[\]\\]/;

/**
 * A "symbol-like" identifier: starts with letter/$/_,
 * followed by alphanumeric/$/_/./- characters.
 * CamelCase, snake_case, dot.notation all qualify.
 */
const SYMBOL_ID_RE = /^[A-Za-z_$][A-Za-z0-9_$.-]*$/;

function isSymbolLike(term: string): boolean {
  return SYMBOL_ID_RE.test(term) && !REGEX_META_RE.test(term);
}

function isSourceFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return false;
  return SOURCE_EXT.has(filePath.slice(dot + 1).toLowerCase());
}

/** Extract the filename stem (basename without extension). */
function fileStem(filePath: string): string {
  const base = filePath.includes('/')
    ? filePath.slice(filePath.lastIndexOf('/') + 1)
    : filePath;
  const dot = base.lastIndexOf('.');
  return dot === -1 ? base : base.slice(0, dot);
}

/**
 * Extract a symbol-like search term from a grep or rg command.
 * Returns null if:
 *   - The term looks like a regex (contains metacharacters)
 *   - The flags indicate non-symbol-discovery use (-c, -v, -l, -L, -o, -Z)
 *   - No clear search term can be identified
 *
 * Flags that trigger passthrough (not symbol search):
 *   -c  count matches per file
 *   -v  invert match (select non-matching lines)
 *   -l  list files that have matches
 *   -L  list files that have NO matches
 *   -o  print only the matching part
 *   -Z  use NUL byte as line separator
 */
function extractGrepSymbol(cmd: string): string | null {
  // Reject if any flag group contains a non-symbol-discovery flag character.
  // This regex looks for a dash followed by any combo of letters containing c/v/l/L/o/Z.
  // We use a word-boundary aware pattern: -rnic is ok (r,n,i,I are fine),
  // -rnc is not (c = count). The flag can appear anywhere after the command name.
  if (/(?:^|\s)-[a-zA-Z]*[cvlLoZ]/.test(cmd)) return null;

  // Try double-quoted or single-quoted term first: grep "Symbol" or grep 'Symbol'
  const quoted = cmd.match(/(?:^|\s)["']([^"']+)["'](?:\s|$)/);
  if (quoted) {
    const term = quoted[1];
    return isSymbolLike(term) ? term : null;
  }

  // Try unquoted term: skip command name and flags to find first bare identifier
  const tokens = cmd.split(/\s+/).slice(1); // skip 'grep' or 'rg'
  for (const tok of tokens) {
    if (tok.startsWith('-')) continue;                      // skip flags
    if (tok.startsWith('/')) continue;                      // skip absolute paths
    if (tok.startsWith('./') || tok.startsWith('../')) continue; // skip relative paths
    if (tok.includes('/')) continue;                        // skip paths with slashes
    if (tok === '.' || tok === '..') continue;              // skip dir shortcuts
    // First non-flag, non-path token is the search pattern
    return isSymbolLike(tok) ? tok : null;
  }

  return null;
}

// ─── Core rewrite function ────────────────────────────────────────────────────

/**
 * Attempt to rewrite `cmd` to its code-intel equivalent.
 *
 * Returns the rewritten command string, or null if no rule matched.
 * NEVER throws — all rule errors silently degrade to null (passthrough).
 */
export function rewriteCommand(cmd: string): string | null {
  try {
    const trimmed = cmd.trim();
    if (!trimmed) return null;

    // ── Guard 1: Already a code-intel command (idempotency + anti-loop) ──────
    // This prevents: code-intel search "X" → being rewritten again.
    if (trimmed.startsWith('code-intel ') || trimmed === 'code-intel') return null;

    // ── Guard 2: Compound commands — pass through in v1 ──────────────────────
    // We don't attempt to split && || ; | in v1.
    // A simple character scan is safe here since we check before any rule matching.
    if (/(?:&&|\|\||;|\|)/.test(trimmed)) return null;

    // ── Rule 1: grep → code-intel search ─────────────────────────────────────
    if (/^grep\s/.test(trimmed)) {
      const sym = extractGrepSymbol(trimmed);
      if (sym) return `code-intel search "${sym}"`;
      return null;
    }

    // ── Rule 2: rg → code-intel search ───────────────────────────────────────
    if (/^rg\s/.test(trimmed)) {
      // Reject rg-specific structural flags (not symbol search)
      if (/\s--files(?:\s|$)/.test(trimmed)) return null;
      if (/\s--files-with-matches(?:\s|$)/.test(trimmed)) return null;
      if (/\s--type-not\b/.test(trimmed)) return null;
      const sym = extractGrepSymbol(trimmed);
      if (sym) return `code-intel search "${sym}"`;
      return null;
    }

    // ── Rule 3: cat <single-source-file> → code-intel inspect <stem> ─────────
    if (/^cat\s/.test(trimmed)) {
      // Must be exactly: cat <one-token> — no multi-file, no options
      const m = trimmed.match(/^cat\s+(\S+)$/);
      if (!m) return null;           // multi-file or flags present
      const filePath = m[1];
      if (filePath === '-') return null;           // stdin passthrough
      if (filePath.startsWith('>')) return null;   // write redirect
      if (!isSourceFile(filePath)) return null;    // not a source file
      return `code-intel inspect ${fileStem(filePath)}`;
    }

    // ── Rule 4: head/tail <single-source-file> → code-intel inspect <stem> ───
    if (/^(?:head|tail)\s/.test(trimmed)) {
      if (/\s-f\b/.test(trimmed)) return null;     // tail -f = live follow, not inspection
      // Accept common forms:
      //   head <file>
      //   head -N <file>
      //   head -n N <file>
      //   head --lines=N <file>
      const m = trimmed.match(
        /^(?:head|tail)\s+(?:-\d+\s+|-n\s+\d+\s+|--lines=\d+\s+)?(\S+)$/,
      );
      if (!m) return null;
      const filePath = m[1];
      if (!isSourceFile(filePath)) return null;
      return `code-intel inspect ${fileStem(filePath)}`;
    }

    return null;
  } catch {
    // Any unexpected error → silently pass through.
    // A rule must NEVER cause the hook to crash.
    return null;
  }
}

// ─── CLI: `code-intel rewrite <cmd>` ─────────────────────────────────────────

/**
 * Entry point for `code-intel rewrite <cmd>`.
 *
 * Exit codes (mirrors RTK exit code protocol):
 *   0 + stdout  → rewrite found; hook may auto-allow the rewritten command
 *   1           → no match; hook passes through unchanged
 */
export function runRewrite(cmd: string): never {
  const rewritten = rewriteCommand(cmd.trim());
  if (rewritten === null) {
    process.exit(1);
  }
  process.stdout.write(rewritten);
  process.exit(0);
}

// ─── CLI: `code-intel hook claude` ───────────────────────────────────────────

/**
 * Entry point for `code-intel hook claude`.
 *
 * Reads a Claude Code PreToolUse JSON payload from stdin.
 * If the command matches a rewrite rule, writes a JSON response to stdout
 * that tells Claude Code to use the rewritten command instead.
 * If no rule matches, exits 0 with empty stdout (pass through unchanged).
 *
 * NON-BLOCKING GUARANTEE: This function ALWAYS exits 0.
 * A non-zero exit would cause Claude Code to block the agent's command.
 * We must never block, even on errors.
 *
 * Claude Code PreToolUse input format (stdin):
 *   { "tool_name": "Bash", "tool_input": { "command": "grep ..." } }
 *
 * Response format when rewriting (stdout):
 *   {
 *     "hookSpecificOutput": {
 *       "hookEventName": "PreToolUse",
 *       "permissionDecision": "allow",
 *       "permissionDecisionReason": "...",
 *       "updatedInput": { "command": "code-intel search ..." }
 *     }
 *   }
 */
/**
 * `code-intel-hook cursor` — reads Cursor preToolUse stdin JSON, writes response JSON.
 *
 * Cursor format differs from Claude Code:
 *   Input:  { "tool_input": { "command": "grep ..." } }
 *   Output (rewrite): { "permission": "allow", "updated_input": { "command": "..." } }
 *   Output (no match): {} (Cursor requires JSON on all paths, even pass-through)
 *
 * ALWAYS exits 0 — non-blocking guarantee.
 */
/**
 * `code-intel-hook copilot` — handles both VS Code Copilot Chat and Copilot CLI.
 *
 * Auto-detects input format:
 *   VS Code Chat:  snake_case { tool_name, tool_input: { command } }
 *                 → updatedInput (transparent rewrite)
 *   Copilot CLI:  camelCase { toolName, toolArgs: '{"command":"..."}' }
 *                 → deny-with-suggestion (CLI doesn't support updatedInput)
 *
 * ALWAYS exits 0 — non-blocking guarantee.
 */
export function runCopilotHook(): void {
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));

  let input = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk: string) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      if (!input.trim()) { process.exit(0); }

      const parsed = JSON.parse(input) as Record<string, unknown>;

      // ── VS Code Copilot Chat format (snake_case) ─────────────────────────
      // tool_name: "runTerminalCommand" | "Bash"
      // tool_input: { command: "..." }
      if (parsed.tool_name && !parsed.toolName) {
        const toolName = parsed.tool_name as string;
        if (!['runTerminalCommand', 'Bash', 'bash'].includes(toolName)) {
          process.exit(0);
        }
        const toolInput = parsed.tool_input as Record<string, unknown> | undefined;
        const cmd = toolInput?.command as string | undefined;
        if (!cmd || !cmd.trim()) { process.exit(0); }

        const rewritten = rewriteCommand(cmd);
        if (rewritten === null || rewritten === cmd) { process.exit(0); }

        // VS Code supports updatedInput — transparent rewrite
        const response = {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: 'code-intel: semantic search replaces grep/cat',
            updatedInput: { ...toolInput, command: rewritten },
          },
        };
        process.stdout.write(JSON.stringify(response));
        process.exit(0);
      }

      // ── Copilot CLI format (camelCase, toolArgs JSON-stringified) ─────────
      // toolName: "bash"
      // toolArgs: '{"command":"..."}'
      if (parsed.toolName) {
        if ((parsed.toolName as string).toLowerCase() !== 'bash') { process.exit(0); }
        let cmd = '';
        try {
          const toolArgs = JSON.parse(parsed.toolArgs as string) as Record<string, unknown>;
          cmd = (toolArgs.command as string) ?? '';
        } catch { process.exit(0); }

        if (!cmd.trim()) { process.exit(0); }
        const rewritten = rewriteCommand(cmd);
        if (rewritten === null || rewritten === cmd) { process.exit(0); }

        // CLI doesn't support updatedInput — use deny-with-suggestion instead
        const response = {
          permissionDecision: 'deny',
          permissionDecisionReason: `Use code-intel: ${rewritten}`,
        };
        process.stdout.write(JSON.stringify(response));
        process.exit(0);
      }

      process.exit(0);
    } catch {
      process.exit(0);
    }
  });
  process.stdin.on('error', () => process.exit(0));
}

export function runCursorHook(): void {
  process.on('uncaughtException', () => { process.stdout.write('{}'); process.exit(0); });
  process.on('unhandledRejection', () => { process.stdout.write('{}'); process.exit(0); });

  let input = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk: string) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      if (!input.trim()) { process.stdout.write('{}'); process.exit(0); }

      const parsed = JSON.parse(input) as {
        tool_input?: { command?: string; [key: string]: unknown };
        [key: string]: unknown;
      };

      const cmd = parsed?.tool_input?.command;
      if (typeof cmd !== 'string' || !cmd.trim()) { process.stdout.write('{}'); process.exit(0); }

      const rewritten = rewriteCommand(cmd);
      if (rewritten === null || rewritten === cmd) { process.stdout.write('{}'); process.exit(0); }

      // Cursor response format: permission + updated_input (no hookSpecificOutput)
      const response = {
        permission: 'allow',
        updated_input: { command: rewritten },
      };
      process.stdout.write(JSON.stringify(response));
      process.exit(0);
    } catch {
      process.stdout.write('{}');
      process.exit(0);
    }
  });
  process.stdin.on('error', () => { process.stdout.write('{}'); process.exit(0); });
}

/**
 * `code-intel-hook gemini` — reads Gemini CLI BeforeTool stdin JSON, writes response JSON.
 *
 * Gemini format differs from Claude Code and Cursor:
 *   Input:  { "tool_name": "run_shell_command", "tool_input": { "command": "grep ..." } }
 *   Output (rewrite): { "decision": "allow", "hookSpecificOutput": { "tool_input": { "command": "..." } } }
 *   Output (no match): { "decision": "allow" }
 *
 * ALWAYS exits 0 — non-blocking guarantee.
 */
export function runGeminiHook(): void {
  process.on('uncaughtException', () => { process.stdout.write('{"decision":"allow"}'); process.exit(0); });
  process.on('unhandledRejection', () => { process.stdout.write('{"decision":"allow"}'); process.exit(0); });

  let input = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk: string) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      if (!input.trim()) { process.stdout.write('{"decision":"allow"}'); process.exit(0); }

      const parsed = JSON.parse(input) as {
        tool_name?: string;
        tool_input?: { command?: string; [key: string]: unknown };
        [key: string]: unknown;
      };

      // Gemini uses tool_name = "run_shell_command"
      const toolName = parsed?.tool_name;
      if (toolName && toolName !== 'run_shell_command') {
        process.stdout.write('{"decision":"allow"}');
        process.exit(0);
      }

      const cmd = parsed?.tool_input?.command;
      if (typeof cmd !== 'string' || !cmd.trim()) {
        process.stdout.write('{"decision":"allow"}');
        process.exit(0);
      }

      const rewritten = rewriteCommand(cmd);
      if (rewritten === null || rewritten === cmd) {
        process.stdout.write('{"decision":"allow"}');
        process.exit(0);
      }

      // Gemini response format: decision + hookSpecificOutput.tool_input
      const response = {
        decision: 'allow',
        hookSpecificOutput: {
          tool_input: { command: rewritten },
        },
      };
      process.stdout.write(JSON.stringify(response));
      process.exit(0);
    } catch {
      process.stdout.write('{"decision":"allow"}');
      process.exit(0);
    }
  });
  process.stdin.on('error', () => { process.stdout.write('{"decision":"allow"}'); process.exit(0); });
}

export function runClaudeHook(): void {
  // Override any previously registered exit(1) handlers.
  // These run before the global handlers in main.ts if anything throws
  // before we reach the try/catch inside stdin.on('end').
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));

  let input = '';
  process.stdin.setEncoding('utf-8');

  process.stdin.on('data', (chunk: string) => {
    input += chunk;
  });

  process.stdin.on('end', () => {
    try {
      if (!input.trim()) {
        process.exit(0);
      }

      // Parse the PreToolUse JSON payload
      const parsed = JSON.parse(input) as {
        tool_input?: { command?: string; [key: string]: unknown };
        [key: string]: unknown;
      };

      const cmd = parsed?.tool_input?.command;
      if (typeof cmd !== 'string' || !cmd.trim()) {
        process.exit(0);
      }

      const rewritten = rewriteCommand(cmd);

      // No match or identical → pass through (empty stdout + exit 0)
      if (rewritten === null || rewritten === cmd) {
        process.exit(0);
      }

      // Build the Claude Code PreToolUse response
      const response = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'code-intel: semantic search replaces grep/cat',
          updatedInput: {
            ...parsed.tool_input,
            command: rewritten,
          },
        },
      };

      process.stdout.write(JSON.stringify(response));
      process.exit(0);
    } catch {
      // JSON parse error, unexpected payload shape, or anything else.
      // ALWAYS exit 0 — never block the agent's command execution.
      process.exit(0);
    }
  });

  process.stdin.on('error', () => {
    process.exit(0); // stdin read error → pass through
  });
}
