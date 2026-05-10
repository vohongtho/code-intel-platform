import type { Plugin } from "@opencode-ai/plugin"
import { execSync } from "node:child_process"

// code-intel OpenCode plugin — rewrites symbol-discovery commands to semantic equivalents.
// Requires: code-intel installed and in PATH.
//
// This is a thin delegating plugin: all rewrite logic lives in `code-intel rewrite`.
// To add or change rewrite rules, edit hook-rewriter.ts — not this file.

let codeIntelAvailable: boolean | null = null

function checkCodeIntel(): boolean {
  if (codeIntelAvailable !== null) return codeIntelAvailable
  try {
    execSync("which code-intel", { stdio: "ignore" })
    codeIntelAvailable = true
  } catch {
    codeIntelAvailable = false
  }
  return codeIntelAvailable
}

function tryRewrite(command: string): string | null {
  try {
    const result = execSync(`code-intel rewrite ${JSON.stringify(command)}`, {
      encoding: "utf-8",
      timeout: 2000,
    }).trim()
    return result && result !== command ? result : null
  } catch {
    // code-intel rewrite exits 1 on no match — that's expected, not an error
    return null
  }
}

export const CodeIntelOpenCodePlugin: Plugin = async ({ $ }) => {
  if (!checkCodeIntel()) {
    console.warn("[code-intel] code-intel binary not found in PATH — plugin disabled")
    return {}
  }

  return {
    "tool.execute.before": async (input, output) => {
      const tool = String(input?.tool ?? "").toLowerCase()
      if (tool !== "bash" && tool !== "shell") return
      const args = output?.args
      if (!args || typeof args !== "object") return

      const command = (args as Record<string, unknown>).command
      if (typeof command !== "string" || !command) return

      try {
        const rewritten = tryRewrite(command)
        if (rewritten) {
          ;(args as Record<string, unknown>).command = rewritten
        }
      } catch {
        // rewrite failed — pass through unchanged (non-blocking guarantee)
      }
    },
  }
}
