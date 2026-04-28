/**
 * LLM Governance Logger — opt-in audit log for AI/LLM calls.
 *
 * When CODE_INTEL_GOVERNANCE_LOGGING=true, logs every LLM invocation to
 * ~/.code-intel/llm-governance.jsonl (JSON Lines format).
 *
 * IMPORTANT: Never log raw source code, file contents, tokens, or passwords.
 * Only log: model, user/agent identity, tool/purpose, token counts, timestamp.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { v4 as uuidv4 } from 'uuid';

export interface GovernanceLogEntry {
  id: string;
  timestamp: string;
  model: string;
  userId: string;
  purpose: string;
  promptTokens: number;
  responseTokens: number;
  durationMs: number;
  outcome: 'success' | 'error';
  errorCode?: string;
}

export class LLMGovernanceLogger {
  /** Is governance logging enabled? */
  isEnabled(): boolean {
    return process.env['CODE_INTEL_GOVERNANCE_LOGGING'] === 'true';
  }

  /** Path to the JSONL log file. */
  getLogPath(): string {
    return (
      process.env['CODE_INTEL_GOVERNANCE_LOG_PATH'] ??
      path.join(os.homedir(), '.code-intel', 'llm-governance.jsonl')
    );
  }

  /**
   * Append an entry to the governance log.
   * No-op when isEnabled() returns false.
   * Never throws — governance must not impact the request path.
   */
  log(entry: Omit<GovernanceLogEntry, 'id' | 'timestamp'>): void {
    if (!this.isEnabled()) return;
    try {
      const full: GovernanceLogEntry = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        ...entry,
      };
      const logPath = this.getLogPath();
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, JSON.stringify(full) + '\n', 'utf-8');
    } catch {
      /* non-fatal — governance logging must never crash the app */
    }
  }

  /**
   * Read the last `limit` governance log entries (most-recent last, JSONL order).
   * Returns empty array when logging is disabled or file does not exist.
   */
  readLog(limit = 100): GovernanceLogEntry[] {
    try {
      const raw = fs.readFileSync(this.getLogPath(), 'utf-8');
      const lines = raw
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .slice(-limit);
      return lines.map((l) => JSON.parse(l) as GovernanceLogEntry);
    } catch {
      return [];
    }
  }
}

/** Singleton governance logger. */
export const governanceLogger = new LLMGovernanceLogger();
