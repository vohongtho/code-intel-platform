import { execSync } from "node:child_process";

// code-intel OpenClaw plugin — rewrites symbol-discovery commands to semantic equivalents.
// Requires: code-intel installed and in PATH.
//
// This is a thin delegating plugin: all rewrite logic lives in `code-intel rewrite`.
// To add or change rewrite rules, edit hook-rewriter.ts — not this file.

let codeIntelAvailable: boolean | null = null;

function checkCodeIntel(): boolean {
  if (codeIntelAvailable !== null) return codeIntelAvailable;
  try {
    execSync("which code-intel", { stdio: "ignore" });
    codeIntelAvailable = true;
  } catch {
    codeIntelAvailable = false;
  }
  return codeIntelAvailable;
}

function tryRewrite(command: string): string | null {
  try {
    const result = execSync(`code-intel rewrite ${JSON.stringify(command)}`, {
      encoding: "utf-8",
      timeout: 2000,
    }).trim();
    return result && result !== command ? result : null;
  } catch {
    // code-intel rewrite exits 1 on no match — that's expected, not an error
    return null;
  }
}

export default function register(api: any) {
  const pluginConfig = api.config ?? {};
  const enabled = pluginConfig.enabled !== false;
  const verbose = pluginConfig.verbose === true;

  if (!enabled) return;

  if (!checkCodeIntel()) {
    console.warn("[code-intel] code-intel binary not found in PATH — plugin disabled");
    return;
  }

  api.on(
    "before_tool_call",
    (event: { toolName: string; params: Record<string, unknown> }) => {
      if (event.toolName !== "exec") return;

      const command = event.params?.command;
      if (typeof command !== "string") return;

      const rewritten = tryRewrite(command);
      if (!rewritten) return;

      if (verbose) {
        console.log(`[code-intel] ${command} -> ${rewritten}`);
      }

      return { params: { ...event.params, command: rewritten } };
    },
    { priority: 10 }
  );

  if (verbose) {
    console.log("[code-intel] OpenClaw plugin registered");
  }
}
