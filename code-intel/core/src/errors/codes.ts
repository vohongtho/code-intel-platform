import { execSync } from 'node:child_process';
import os from 'node:os';

export const ErrorCodes = {
  // Auth (CI-1xxx)
  UNAUTHORIZED:          'CI-1000',
  FORBIDDEN:             'CI-1001',
  NOT_FOUND:             'CI-1002',
  ANALYSIS_IN_PROGRESS:  'CI-1003',
  INDEX_NOT_FOUND:       'CI-1004',
  DB_CORRUPTED:          'CI-1042',
  RATE_LIMIT_EXCEEDED:   'CI-1100',
  PAYLOAD_TOO_LARGE:     'CI-1101',
  INVALID_REQUEST:       'CI-1200',
  // Config (CI-2xxx)
  CONFIG_INVALID:        'CI-2000',
  CONFIG_NOT_FOUND:      'CI-2001',
  // Analysis (CI-3xxx)
  ANALYSIS_FAILED:       'CI-3000',
  // DB (CI-4xxx)
  DB_ERROR:              'CI-4000',
  // Network (CI-5xxx)
  NETWORK_ERROR:         'CI-5001',
  // Internal (CI-9xxx)
  INTERNAL_ERROR:        'CI-5000',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/** Base error class with CI-XXXX code, hint, and optional docs URL. */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public hint: string,
    public statusCode: number = 500,
    public docs?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Not authenticated — run `code-intel auth login` */
export class AuthError extends AppError {
  constructor(message = 'Not authenticated', hint = 'Run `code-intel auth login`') {
    super(ErrorCodes.UNAUTHORIZED, message, hint, 401, 'https://github.com/vohongtho/code-intel-platform#authentication');
    this.name = 'AuthError';
  }
}

/** Repository not indexed — run `code-intel analyze` */
export class AnalysisError extends AppError {
  constructor(message = 'Repository not indexed', hint = 'Run `code-intel analyze`') {
    super(ErrorCodes.INDEX_NOT_FOUND, message, hint, 404, 'https://github.com/vohongtho/code-intel-platform#analyze');
    this.name = 'AnalysisError';
  }
}

/** Config invalid — run `code-intel config validate` */
export class ConfigError extends AppError {
  constructor(message = 'Configuration is invalid', hint = 'Run `code-intel config validate`') {
    super(ErrorCodes.CONFIG_INVALID, message, hint, 500, 'https://github.com/vohongtho/code-intel-platform#config');
    this.name = 'ConfigError';
  }
}

/** Database error — run `code-intel clean && code-intel analyze` */
export class DBError extends AppError {
  constructor(message = 'Database error', hint = 'Run `code-intel clean && code-intel analyze`') {
    super(ErrorCodes.DB_CORRUPTED, message, hint, 500, 'https://github.com/vohongtho/code-intel-platform#troubleshooting');
    this.name = 'DBError';
  }
}

/** Network / connectivity error */
export class NetworkError extends AppError {
  constructor(message = 'Network error', hint = 'Check your internet connection and try again') {
    super(ErrorCodes.NETWORK_ERROR, message, hint, 503, 'https://github.com/vohongtho/code-intel-platform#troubleshooting');
    this.name = 'NetworkError';
  }
}
// ── CLI error formatting ──────────────────────────────────────────────────────

/**
 * Format an AppError (or any Error) for clean CLI output.
 * Stack trace is suppressed unless `debug` is true.
 */
export function formatCliError(err: unknown, debug = false): string {
  if (err instanceof AppError) {
    const lines: string[] = [
      `\n  ✗  [${err.code}] ${err.message}`,
      `     Hint: ${err.hint}`,
    ];
    if (err.docs) lines.push(`     Docs: ${err.docs}`);
    if (debug && err.stack) lines.push('\n' + err.stack);
    lines.push('');
    return lines.join('\n');
  }
  if (err instanceof Error) {
    const lines = [`\n  ✗  ${err.message}`];
    if (debug && err.stack) lines.push('\n' + err.stack);
    lines.push('');
    return lines.join('\n');
  }
  return `\n  ✗  Unknown error: ${String(err)}\n`;
}

// ── Startup prerequisite checks ───────────────────────────────────────────────

export interface PrerequisiteCheck {
  name: string;
  ok: boolean;
  level: 'error' | 'warn';
  message: string;
}

/** Run startup prerequisite checks. Returns list of failed/warning checks only. */
export function runPrerequisiteChecks(): PrerequisiteCheck[] {
  const results: PrerequisiteCheck[] = [];

  // Node.js version ≥ 22
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 22) {
    results.push({
      name: 'Node.js version',
      ok: false,
      level: 'warn',
      message: `Node.js v${process.versions.node} detected — v22 or higher is recommended`,
    });
  }

  // git in PATH
  try {
    execSync('git --version', { stdio: 'pipe' });
  } catch {
    results.push({
      name: 'git',
      ok: false,
      level: 'warn',
      message: 'git not found in PATH — some features (incremental analysis) will not work',
    });
  }

  // Disk space > 500 MB on home dir
  try {
    const out = execSync(`df -BM "${os.homedir()}" 2>/dev/null | tail -1 | awk '{print $4}'`, { encoding: 'utf8' });
    const availMB = parseInt(out.trim().replace('M', ''), 10);
    if (Number.isFinite(availMB) && availMB < 500) {
      results.push({
        name: 'Disk space',
        ok: false,
        level: 'warn',
        message: `Low disk space: ${availMB} MB available in ${os.homedir()} (500 MB recommended)`,
      });
    }
  } catch {
    // Ignore — disk check is best-effort
  }

  return results;
}
