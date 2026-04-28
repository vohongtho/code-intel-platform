/**
 * Logger with sensitive data masking.
 * Uses winston + winston-daily-rotate-file.
 *
 * - In production / CI (NODE_ENV=production): Console only (stdout, structured).
 * - Otherwise: Daily-rotating file logs under ./logs/ + Console.
 * - Log level controlled by LOG_LEVEL env var (default: "info").
 * - Sensitive keys and patterns are masked before output.
 * - Every log line includes { traceId, spanId } from the active OTel span
 *   when tracing is enabled.
 *
 * @module shared/Logger
 */
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Lazy OTel trace context — loaded dynamically to avoid circular deps and to
// remain a no-op when OTel is not enabled. The getter is synchronous once
// the module is cached.
type TraceContextFn = () => { traceId: string; spanId: string };
let _getTraceCtx: TraceContextFn | null | 'pending' = null;

function getActiveTraceCtx(): { traceId: string; spanId: string } {
  if (_getTraceCtx === 'pending') return { traceId: '', spanId: '' };
  if (_getTraceCtx) return _getTraceCtx();
  // Attempt to lazy-load (once) without blocking
  _getTraceCtx = 'pending';
  import('../observability/tracing.js')
    .then((mod) => {
      _getTraceCtx = (mod as { getActiveTraceContext: TraceContextFn }).getActiveTraceContext;
    })
    .catch(() => {
      _getTraceCtx = null;
    });
  return { traceId: '', spanId: '' };
}

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
  /(?:bearer\s+)([a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+)/gi,
];

const SENSITIVE_KEYS_REGEX = new RegExp(`^(${SENSITIVE_KEYS.join('|')})$`, 'i');

class Logger {
  private static instance: winston.Logger | null = null;

  static maskSensitiveData(value: string): string {
    if (typeof value === 'string' && value.length > 5) {
      const firstChar = value.at(0)!;
      const lastChar = value.at(-1)!;
      return firstChar + '*'.repeat(value.length - 2) + lastChar;
    }
    return value;
  }

  static maskSensitive(message: string, args: unknown[] = []): { maskedMessage: string; maskedArgs: unknown[] } {
    const maskString = (input: string): string => {
      if (typeof input !== 'string') return input;
      return SENSITIVE_PATTERNS.reduce((str, pattern) => {
        return str.replace(pattern, (match: string, value: string) =>
          value ? match.replace(value, Logger.maskSensitiveData(value)) : match,
        );
      }, input);
    };

    const deepMask = (obj: unknown): unknown => {
      if (typeof obj === 'string') return maskString(obj);
      if (Array.isArray(obj)) return obj.map((item: unknown) => deepMask(item));
      if (typeof obj === 'object' && obj !== null) {
        return Object.entries(obj as Record<string, unknown>).reduce(
          (acc: Record<string, unknown>, [key, value]) => {
            if (value === undefined) return acc;
            const isSensitiveKey = SENSITIVE_KEYS_REGEX.test(key);
            acc[key] = isSensitiveKey && typeof value === 'string'
              ? Logger.maskSensitiveData(value)
              : deepMask(value);
            return acc;
          },
          {},
        );
      }
      return obj;
    };

    return {
      maskedMessage: maskString(message),
      maskedArgs: args.map((arg: unknown) => deepMask(arg)),
    };
  }

  /** Global log directory: ~/.code-intel/logs */
  static readonly LOG_DIR = path.join(os.homedir(), '.code-intel', 'logs');

  static getLogger(): winston.Logger {
    if (!Logger.instance) {
      const isProduction = process.env.NODE_ENV === 'production';
      const logLevel = process.env.LOG_LEVEL ?? 'info';
      const transports: winston.transport[] = [];

      // Always add console transport
      transports.push(new winston.transports.Console());

      if (!isProduction) {
        // Dev + global installs: rotate logs into ~/.code-intel/logs/
        try {
          if (!fs.existsSync(Logger.LOG_DIR)) {
            fs.mkdirSync(Logger.LOG_DIR, { recursive: true });
          }
          transports.push(
            new DailyRotateFile({
              filename: path.join(Logger.LOG_DIR, '%DATE%-code-intel.log'),
              datePattern: 'YYYY-MM-DD',
              maxSize: '20m',
              maxFiles: '14d',
            }),
          );
        } catch {
          // If we can't write to the log dir (e.g. read-only FS), continue console-only
        }
      }

      Logger.instance = winston.createLogger({
        level: logLevel,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const args = (meta[Symbol.for('splat') as unknown as string] as unknown[]) || [];
            const { maskedMessage, maskedArgs } = Logger.maskSensitive(message as string, args);
            const formattedArgs = maskedArgs.map((arg: unknown) =>
              typeof arg === 'object' ? JSON.stringify(arg) : String(arg),
            );
            const suffix = formattedArgs.length ? ' ' + formattedArgs.join(' ') : '';
            // Include OTel trace context when available
            let traceCtx = '';
            try {
              const { traceId, spanId } = getActiveTraceCtx();
              if (traceId) traceCtx = ` [trace=${traceId} span=${spanId}]`;
            } catch { /* OTel not loaded */ }
            return `${timestamp} [${level.toUpperCase()}]${traceCtx}: ${maskedMessage}${suffix}`;
          }),
        ),
        transports,
      });
    }
    return Logger.instance;
  }

  static info(message: string, ...args: unknown[]): void {
    Logger.getLogger().info(message, ...args);
  }

  static warn(message: string, ...args: unknown[]): void {
    Logger.getLogger().warn(message, ...args);
  }

  static error(message: string, ...args: unknown[]): void {
    Logger.getLogger().error(message, ...args);
  }

  static debug(message: string, ...args: unknown[]): void {
    Logger.getLogger().debug(message, ...args);
  }
}

export default Logger;

// Eagerly initialize so the log directory and file transport are created on import,
// even if no log messages are emitted during a short run.
Logger.getLogger();
