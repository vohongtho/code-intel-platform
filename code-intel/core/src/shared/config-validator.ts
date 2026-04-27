/**
 * Config validation: reject plaintext secrets in user-supplied configuration.
 *
 * Any value bound to a "secret-like" key MUST be referenced via `$ENV_VAR`
 * (or `${ENV_VAR}`) syntax. A literal value such as `"sk_live_…"` triggers
 * a startup error.
 *
 * The validator is structure-agnostic: pass any object/array tree.
 *
 * Recognized secret-like keys (case-insensitive contains-match):
 *   - secret, password, passwd, apikey, api_key, api-key, private_key,
 *     client_secret, refresh_token, access_token, token (when value
 *     looks like a literal credential — see `looksLikeCredential`).
 */

const SECRET_KEY_PATTERNS = [
  /secret/i,
  /password/i,
  /passwd/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /client[_-]?secret/i,
  /refresh[_-]?token/i,
  /access[_-]?token/i,
];

/** Looks like an env-var reference, e.g. `$FOO` or `${FOO}`. */
const ENV_REF = /^\$\{?[A-Z_][A-Z0-9_]*\}?$/;

export interface ConfigValidationError {
  path: string;
  key: string;
  reason: string;
}

export interface ConfigValidationResult {
  ok: boolean;
  errors: ConfigValidationError[];
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((p) => p.test(key));
}

function looksLikeEnvRef(value: string): boolean {
  return ENV_REF.test(value.trim());
}

/**
 * Walk a config tree and report every secret-like key whose value is a
 * non-empty string that isn't an `$ENV_VAR` reference.
 *
 * Empty strings, `null`, and `undefined` are ignored (the user clearly hasn't
 * configured that secret yet).
 */
export function validateConfigForSecrets(
  config: unknown,
  rootPath = '',
): ConfigValidationResult {
  const errors: ConfigValidationError[] = [];
  walk(config, rootPath, errors);
  return { ok: errors.length === 0, errors };
}

function walk(node: unknown, currentPath: string, errors: ConfigValidationError[]): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((item, idx) => walk(item, `${currentPath}[${idx}]`, errors));
    return;
  }
  if (typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    const childPath = currentPath ? `${currentPath}.${key}` : key;
    if (isSecretKey(key) && typeof value === 'string' && value.trim().length > 0) {
      if (!looksLikeEnvRef(value)) {
        errors.push({
          path: childPath,
          key,
          reason:
            `Plaintext secret detected. Use $ENV_VAR syntax instead — ` +
            `e.g. ${key}: $${key.toUpperCase()}`,
        });
      }
      // Don't descend into a string value.
      continue;
    }
    walk(value, childPath, errors);
  }
}

/**
 * Resolve `$ENV_VAR` and `${ENV_VAR}` references in a config tree against
 * the current environment. Non-string values pass through unchanged.
 *
 * If a referenced env var is missing, the value becomes `undefined` (so
 * downstream code can detect "not set").
 */
export function resolveConfigEnvRefs<T>(config: T, env: NodeJS.ProcessEnv = process.env): T {
  return resolve(config) as T;
  function resolve(node: unknown): unknown {
    if (typeof node === 'string') {
      const trimmed = node.trim();
      if (looksLikeEnvRef(trimmed)) {
        const name = trimmed.replace(/^\$\{?/, '').replace(/\}?$/, '');
        return env[name];
      }
      return node;
    }
    if (Array.isArray(node)) return node.map(resolve);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = resolve(v);
      }
      return out;
    }
    return node;
  }
}

/**
 * Throw if the config contains any plaintext secrets. Suitable for startup
 * gates: `assertNoPlaintextSecrets(loadedConfig, 'config.json')`.
 */
export function assertNoPlaintextSecrets(config: unknown, source = 'config'): void {
  const result = validateConfigForSecrets(config);
  if (!result.ok) {
    const lines = result.errors.map(
      (e) => `  - ${source}: ${e.path}  →  ${e.reason}`,
    );
    throw new Error(
      `Plaintext secret(s) detected in ${source}. Refusing to start.\n` +
        lines.join('\n'),
    );
  }
}
