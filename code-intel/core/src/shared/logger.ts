/**
 * Lightweight singleton logger with sensitive-data masking.
 * Drop-in replacement for console.* — no external dependencies.
 *
 * Log level is controlled by the LOG_LEVEL env var (default: "info").
 * Valid values: "debug" | "info" | "warn" | "error" | "silent"
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 } as const;
type Level = keyof typeof LEVELS;

// ─── Sensitive-data masking ───────────────────────────────────────────────────

const SENSITIVE_KEYS: string[] = [
  'password', 'passwd', 'pass', 'pwd', 'secret', 'secretkey', 'secret_key', 'secretaccesskey', 'accesskeyid',
  'credentials', 'auth', 'authentication', 'login',
  'api_key', 'apikey', 'api', 'access_key', 'access_token', 'accesskey',
  'auth_key', 'auth_token', 'authkey', 'token', 'jwt', 'bearer_token',
  'refresh_token', 'session_token', 'session_key', 'oauth_token',
  'connection_string', 'conn_string', 'db_uri', 'db_url', 'database_url',
  'mongodb_uri', 'mysql_uri', 'postgres_uri', 'sql_uri',
  'db_username', 'db_password', 'db_host', 'db_port', 'db_name',
  'encryption_key', 'crypto_key', 'private_key', 'public_key', 'ssl_key',
  'ssh_key', 'pgp_key', 'rsa_key', 'aes_key',
  'email', 'phone', 'telephone', 'mobile', 'ssn', 'social_security',
  'credit_card', 'cc_number', 'card_number', 'cvv', 'expiry_date',
  'birth_date', 'dob', 'address', 'zip_code', 'postal_code',
  'bank_account', 'iban', 'swift_code', 'routing_number',
  'tax_id', 'vat_number', 'financial_id',
  'certificate', 'client_cert', 'server_cert', 'ca_cert',
  'aws_key', 'aws_secret', 'azure_key', 'gcp_key', 's3_key',
  'cloudinary_key', 'stripe_key', 'paypal_key', 'twilio_key',
  'app_secret', 'client_secret', 'consumer_secret', 'encryption_secret',
  'master_key', 'root_password', 'admin_password',
  'config_secret', 'env_secret', 'deploy_key', 'ci_key',
  'session_id', 'cookie_secret', 'csrf_token', 'xsrf_token',
  'license_key', 'product_key', 'serial_number', 'activation_code',
];

const SENSITIVE_KEYS_REGEX = new RegExp(`^(${SENSITIVE_KEYS.join('|')})$`, 'i');

const SENSITIVE_PATTERNS: RegExp[] = [
  /(?:password|passwd|secret|api_key|access_token|auth_token|token)\s*[:=]\s*([^\s,]+)/gi,
  /\b\d{16}\b/gi,
  /\b\d{3}-\d{2}-\d{4}\b/gi,
  /\b[A-Za-z0-9]{32}\b/gi,
  /\b[A-Za-z0-9_-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}\b/gi,
  /\b\d{10}\b/gi,
  /\b[A-Za-z0-9]{64}\b/gi,
  /(?:connection_string|db_uri|db_url|mongodb_uri)\s*[:=]\s*([^\s,]+)/gi,
  /(?:apikey|api_key|auth_key)\s*[:=]\s*([^\s,]+)/gi,
  /(?:bearer\s+)[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/gi,
];

function maskValue(value: string): string {
  if (typeof value === 'string' && value.length > 5) {
    return value[0] + '*'.repeat(value.length - 2) + value[value.length - 1];
  }
  return value;
}

function maskString(input: string): string {
  if (typeof input !== 'string') return input;
  return SENSITIVE_PATTERNS.reduce((str, pattern) => {
    return str.replace(pattern, (match: string, value: string) =>
      value ? match.replace(value, maskValue(value)) : match,
    );
  }, input);
}

function deepMask(obj: unknown): unknown {
  if (typeof obj === 'string') return maskString(obj);
  if (Array.isArray(obj)) return obj.map(deepMask);
  if (typeof obj === 'object' && obj !== null) {
    return Object.entries(obj as Record<string, unknown>).reduce(
      (acc: Record<string, unknown>, [key, value]) => {
        if (value === undefined) return acc;
        const isSensitive = SENSITIVE_KEYS_REGEX.test(key);
        acc[key] = isSensitive && typeof value === 'string'
          ? maskValue(value)
          : deepMask(value);
        return acc;
      },
      {},
    );
  }
  return obj;
}

// ─── Logger class ─────────────────────────────────────────────────────────────

class Logger {
  private static _level: Level = (() => {
    const env = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as Level;
    return env in LEVELS ? env : 'info';
  })();

  static setLevel(level: Level): void {
    Logger._level = level;
  }

  private static _shouldLog(level: Level): boolean {
    return LEVELS[level] >= LEVELS[Logger._level];
  }

  private static _format(level: Level, message: string, args: unknown[]): string {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 23);
    const maskedMsg = maskString(message);
    const maskedArgs = args.map(deepMask).map((a) =>
      typeof a === 'object' ? JSON.stringify(a) : String(a),
    );
    const suffix = maskedArgs.length ? ' ' + maskedArgs.join(' ') : '';
    return `${ts} [${level.toUpperCase()}]: ${maskedMsg}${suffix}`;
  }

  static debug(message: string, ...args: unknown[]): void {
    if (!Logger._shouldLog('debug')) return;
    console.debug(Logger._format('debug', message, args));
  }

  static info(message: string, ...args: unknown[]): void {
    if (!Logger._shouldLog('info')) return;
    console.log(Logger._format('info', message, args));
  }

  static warn(message: string, ...args: unknown[]): void {
    if (!Logger._shouldLog('warn')) return;
    console.warn(Logger._format('warn', message, args));
  }

  static error(message: string, ...args: unknown[]): void {
    if (!Logger._shouldLog('error')) return;
    console.error(Logger._format('error', message, args));
  }
}

export default Logger;
