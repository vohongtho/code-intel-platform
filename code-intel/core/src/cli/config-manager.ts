/**
 * Config Management CLI helpers
 *
 * Supports:
 *  - Dot-path get/set  (e.g. "llm.provider", "serve.defaultPort")
 *  - JSON Schema validation
 *  - $ENV_VAR expansion in string values
 *  - Masking of sensitive keys in list output
 */

import { loadConfig, saveConfig, wipeConfig, DEFAULT_CONFIG } from './init-wizard.js';
import type { CodeIntelConfig } from './init-wizard.js';

// ── Sensitive key patterns (same logic as config-validator.ts) ────────────────
const SENSITIVE_PATTERNS = [
  /secret/i,
  /password/i,
  /passwd/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /client[_-]?secret/i,
  /refresh[_-]?token/i,
  /access[_-]?token/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(key));
}

function maskValue(value: unknown): unknown {
  if (typeof value !== 'string' || value === '') return value;
  if (value.startsWith('$')) return value; // env ref — show as-is
  return '***';
}

/** Deep-clone and mask all sensitive leaf values. */
export function maskConfig(cfg: unknown): unknown {
  if (cfg === null || cfg === undefined) return cfg;
  if (Array.isArray(cfg)) return (cfg as unknown[]).map(maskConfig);
  if (typeof cfg === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cfg as Record<string, unknown>)) {
      result[k] = isSensitiveKey(k) ? maskValue(v) : maskConfig(v);
    }
    return result;
  }
  return cfg;
}

// ── Dot-path helpers ──────────────────────────────────────────────────────────

/** Get a value by dot-path notation, e.g. "llm.provider" */
export function getByPath(obj: unknown, dotPath: string): unknown {
  const parts = dotPath.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Set a value by dot-path notation, mutates obj in place. Creates missing objects. */
export function setByPath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const parts = dotPath.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cur[part] === undefined || cur[part] === null || typeof cur[part] !== 'object') {
      cur[part] = {};
    }
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

// ── JSON Schema ───────────────────────────────────────────────────────────────

export interface SchemaField {
  type: 'string' | 'number' | 'boolean' | 'array';
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
  description?: string;
}

export const CONFIG_SCHEMA: Record<string, SchemaField> = {
  'llm.provider':           { type: 'string', enum: ['openai', 'anthropic', 'ollama', 'custom', 'none'], default: 'ollama', description: 'LLM provider for AI summaries' },
  'llm.model':              { type: 'string', default: 'llama3', description: 'LLM model name' },
  'llm.apiKey':             { type: 'string', default: '', description: 'API key — use $ENV_VAR syntax, e.g. $OPENAI_API_KEY' },
  'llm.baseUrl':            { type: 'string', default: '', description: 'Base URL for custom OpenAI-compatible API (e.g. http://localhost:1234/v1)' },
  'llm.batchSize':          { type: 'number', minimum: 1, maximum: 100, default: 20, description: 'Concurrent LLM calls per batch' },
  'llm.contextWindow':      { type: 'number', minimum: 512, maximum: 1000000, default: 8192, description: 'Model context window size in tokens (used to auto-pack symbols into batches)' },
  'llm.maxTokensPerSummary':{ type: 'number', minimum: 10, maximum: 2000, default: 100, description: 'Max tokens per AI summary' },
  'embeddings.model':       { type: 'string', default: 'all-MiniLM-L6-v2', description: 'Embedding model name' },
  'embeddings.enabled':     { type: 'boolean', default: false, description: 'Enable vector search' },
  'analysis.maxFileSizeKB': { type: 'number', minimum: 1, maximum: 102400, default: 512, description: 'Skip files larger than this (KB)' },
  'analysis.ignorePatterns':{ type: 'array', default: [], description: 'Glob patterns to ignore during analysis' },
  'analysis.incrementalByDefault': { type: 'boolean', default: false, description: 'Use incremental analysis by default' },
  'serve.defaultPort':      { type: 'number', minimum: 1, maximum: 65535, default: 4747, description: 'Default HTTP server port' },
  'serve.openBrowser':      { type: 'boolean', default: true, description: 'Auto-open browser when serving' },
  'auth.mode':              { type: 'string', enum: ['local', 'oidc'], default: 'local', description: 'Auth mode for the web UI' },
  'auth.oidc.issuerUrl':    { type: 'string', default: '', description: 'OIDC provider issuer URL' },
  'auth.oidc.clientId':     { type: 'string', default: '', description: 'OIDC client ID' },
  'auth.oidc.clientSecret': { type: 'string', default: '', description: 'OIDC client secret — use $ENV_VAR syntax' },
  'updates.checkOnStartup': { type: 'boolean', default: true, description: 'Check for updates on startup' },
  'updates.intervalHours':  { type: 'number', minimum: 1, maximum: 720, default: 24, description: 'How often to check for updates (hours)' },
  'telemetry.enabled':      { type: 'boolean', default: false, description: 'Enable anonymous telemetry' },
};

export interface ValidationError {
  path: string;
  value: unknown;
  reason: string;
  hint: string;
}

/** Validate a loaded config against the schema. Returns list of errors. */
export function validateConfig(cfg: CodeIntelConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [dotPath, schema] of Object.entries(CONFIG_SCHEMA)) {
    const value = getByPath(cfg as unknown, dotPath);
    if (value === undefined || value === null) continue; // missing optional field is OK

    if (schema.type === 'string' && typeof value !== 'string') {
      errors.push({ path: dotPath, value, reason: `Expected string, got ${typeof value}`, hint: `Set with: code-intel config set ${dotPath} "<value>"` });
    } else if (schema.type === 'number' && typeof value !== 'number') {
      errors.push({ path: dotPath, value, reason: `Expected number, got ${typeof value}`, hint: `Set with: code-intel config set ${dotPath} <number>` });
    } else if (schema.type === 'boolean' && typeof value !== 'boolean') {
      errors.push({ path: dotPath, value, reason: `Expected boolean, got ${typeof value}`, hint: `Set with: code-intel config set ${dotPath} true|false` });
    } else if (schema.type === 'array' && !Array.isArray(value)) {
      errors.push({ path: dotPath, value, reason: `Expected array, got ${typeof value}`, hint: `Set with: code-intel config set ${dotPath} '["pattern1","pattern2"]'` });
    } else if (schema.enum && !schema.enum.includes(value)) {
      errors.push({ path: dotPath, value, reason: `Value "${value}" is not allowed. Allowed: ${schema.enum.join(', ')}`, hint: `Set with: code-intel config set ${dotPath} ${schema.enum[0]}` });
    } else if (schema.minimum !== undefined && typeof value === 'number' && value < schema.minimum) {
      errors.push({ path: dotPath, value, reason: `Value ${value} is below minimum ${schema.minimum}`, hint: `Set with: code-intel config set ${dotPath} ${schema.minimum}` });
    } else if (schema.maximum !== undefined && typeof value === 'number' && value > schema.maximum) {
      errors.push({ path: dotPath, value, reason: `Value ${value} exceeds maximum ${schema.maximum}`, hint: `Set with: code-intel config set ${dotPath} ${schema.maximum}` });
    }

    // Warn if sensitive key has a plaintext (non-$ENV_VAR) value
    const lastKey = dotPath.split('.').pop()!;
    if (isSensitiveKey(lastKey) && typeof value === 'string' && value.length > 0 && !value.startsWith('$')) {
      errors.push({ path: dotPath, value: '***', reason: 'Plaintext secret detected', hint: `Use $ENV_VAR syntax: code-intel config set ${dotPath} $${lastKey.toUpperCase()}` });
    }
  }

  return errors;
}

// ── Coerce string → typed value ───────────────────────────────────────────────

/** Parse a CLI string value to the appropriate type for the given dot-path. */
export function coerceValue(dotPath: string, raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const schema = CONFIG_SCHEMA[dotPath];
  if (!schema) {
    // Unknown path: try JSON parse, then fallback to string
    try { return { ok: true, value: JSON.parse(raw) }; } catch { return { ok: true, value: raw }; }
  }

  switch (schema.type) {
    case 'boolean': {
      const lower = raw.toLowerCase();
      if (lower === 'true' || lower === '1' || lower === 'yes') return { ok: true, value: true };
      if (lower === 'false' || lower === '0' || lower === 'no') return { ok: true, value: false };
      return { ok: false, error: `Expected boolean (true/false), got "${raw}"` };
    }
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { ok: false, error: `Expected number, got "${raw}"` };
      return { ok: true, value: n };
    }
    case 'array': {
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return { ok: false, error: 'Expected a JSON array, e.g. ["a","b"]' };
        return { ok: true, value: parsed };
      } catch {
        return { ok: false, error: 'Expected a JSON array, e.g. ["a","b"]' };
      }
    }
    default:
      return { ok: true, value: raw };
  }
}

// ── $ENV_VAR expansion ────────────────────────────────────────────────────────

const ENV_REF = /^\$\{?[A-Z_][A-Z0-9_]*\}?$/;

export function expandEnvRefs<T>(cfg: T): T {
  return expand(cfg) as T;
  function expand(node: unknown): unknown {
    if (typeof node === 'string') {
      const t = node.trim();
      if (ENV_REF.test(t)) {
        const name = t.replace(/^\$\{?/, '').replace(/\}?$/, '');
        return process.env[name] ?? undefined;
      }
      return node;
    }
    if (Array.isArray(node)) return (node as unknown[]).map(expand);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = expand(v);
      }
      return out;
    }
    return node;
  }
}

// ── High-level commands ───────────────────────────────────────────────────────

/** code-intel config get <key> */
export function configGet(key: string): void {
  const cfg = loadConfig();
  if (!cfg) {
    console.error('\n  ✗  No config found. Run `code-intel init` first.\n');
    process.exit(1);
  }
  const value = getByPath(cfg as unknown, key);
  if (value === undefined) {
    console.error(`\n  ✗  Key "${key}" not found in config.\n`);
    console.error(`     Known keys: ${Object.keys(CONFIG_SCHEMA).slice(0, 5).join(', ')}…\n`);
    process.exit(1);
  }
  // Mask if sensitive
  const lastKey = key.split('.').pop()!;
  const display = isSensitiveKey(lastKey) ? maskValue(value) : value;
  console.log(typeof display === 'string' ? display : JSON.stringify(display, null, 2));
}

/** code-intel config set <key> <value> */
export function configSet(key: string, rawValue: string): void {
  const cfg = loadConfig() ?? (JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as CodeIntelConfig);

  const coerced = coerceValue(key, rawValue);
  if (!coerced.ok) {
    console.error(`\n  ✗  ${coerced.error}\n`);
    process.exit(1);
  }

  setByPath(cfg as unknown as Record<string, unknown>, key, coerced.value);

  // Validate after set
  const errors = validateConfig(cfg);
  if (errors.length > 0) {
    console.error('\n  ✗  Config validation failed after set:');
    for (const e of errors) {
      console.error(`     • ${e.path}: ${e.reason}`);
      console.error(`       Hint: ${e.hint}`);
    }
    console.error('');
    process.exit(1);
  }

  saveConfig(cfg);
  console.log(`  ✅  ${key} = ${typeof coerced.value === 'string' ? coerced.value : JSON.stringify(coerced.value)}`);
}

/** code-intel config list */
export function configList(): void {
  const cfg = loadConfig();
  if (!cfg) {
    console.error('\n  ✗  No config found. Run `code-intel init` first.\n');
    process.exit(1);
  }
  const masked = maskConfig(cfg);
  console.log('\n  ~/.code-intel/config.json\n');
  console.log(JSON.stringify(masked, null, 2));
  console.log('');
}

/** code-intel config validate */
export function configValidate(): boolean {
  const cfg = loadConfig();
  if (!cfg) {
    console.error('\n  ✗  No config found at ~/.code-intel/config.json');
    console.error('     Run `code-intel init` to create it.\n');
    process.exit(1);
  }
  const errors = validateConfig(cfg);
  if (errors.length === 0) {
    console.log('\n  ✅  Config is valid.\n');
    return true;
  }
  console.error(`\n  ✗  Config has ${errors.length} error(s):\n`);
  for (const e of errors) {
    console.error(`  • ${e.path}`);
    console.error(`    Reason: ${e.reason}`);
    console.error(`    Hint:   ${e.hint}`);
    console.error('');
  }
  return false;
}

/** code-intel config reset (non-interactive version for --yes) */
export function configReset(): void {
  const defaults = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as CodeIntelConfig;
  saveConfig(defaults);
  console.log('\n  ✅  Config reset to defaults.\n');
}
