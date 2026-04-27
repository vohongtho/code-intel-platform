/**
 * OpenTelemetry distributed tracing bootstrap.
 *
 * Call `initTracing()` once at process startup — before any imports that
 * you want auto-instrumented (HTTP, DB, etc.).
 *
 * Configuration via environment variables:
 *   CODE_INTEL_OTEL_ENABLED     = "true"  (default: false — opt-in)
 *   CODE_INTEL_OTEL_ENDPOINT    = "http://localhost:4318"  (OTLP/HTTP)
 *   CODE_INTEL_OTEL_SERVICE     = "code-intel"  (service.name attribute)
 *   CODE_INTEL_OTEL_ENV         = "production"  (deployment.environment)
 *
 * When disabled, all `trace.*` calls become no-ops (zero overhead).
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';
import {
  trace,
  context,
  SpanStatusCode,
  type Span,
  type Attributes,
} from '@opentelemetry/api';

// Re-export so callers don't need to depend on @opentelemetry/api directly
export { trace, context, SpanStatusCode };
export type { Span, Attributes };

let _sdk: NodeSDK | null = null;

export function isTracingEnabled(): boolean {
  return process.env['CODE_INTEL_OTEL_ENABLED'] === 'true';
}

export function initTracing(): void {
  if (!isTracingEnabled()) return;
  if (_sdk) return; // already initialised

  const endpoint =
    process.env['CODE_INTEL_OTEL_ENDPOINT'] ?? 'http://localhost:4318';
  const serviceName =
    process.env['CODE_INTEL_OTEL_SERVICE'] ?? 'code-intel';
  const deploymentEnv =
    process.env['CODE_INTEL_OTEL_ENV'] ?? process.env['NODE_ENV'] ?? 'development';

  const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

  _sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: serviceName,
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: deploymentEnv,
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable noisy file-system instrumentation
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  _sdk.start();
}

export async function shutdownTracing(): Promise<void> {
  if (_sdk) {
    await _sdk.shutdown();
    _sdk = null;
  }
}

// ── Tracer factory ───────────────────────────────────────────────────────────

const TRACER_NAME = 'code-intel';

export function getTracer() {
  return trace.getTracer(TRACER_NAME);
}

/**
 * Wrap an async function in a span. Safe to call even when tracing is
 * disabled — the callback still runs, the span is just a no-op.
 *
 * @param name   Span name
 * @param attrs  Optional initial span attributes (must not contain secrets)
 * @param fn     The async work to perform
 */
export async function withSpan<T>(
  name: string,
  attrs: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return getTracer().startActiveSpan(name, { attributes: sanitizeAttrs(attrs) }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Strip any attribute keys that look like they might carry secrets.
 * Span attributes must never include raw code, tokens, or passwords.
 */
const BLOCKED_ATTR_KEYS = /secret|password|token|key|auth|credential/i;

export function sanitizeAttrs(attrs: Attributes): Attributes {
  const safe: Attributes = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (BLOCKED_ATTR_KEYS.test(k)) continue;
    safe[k] = v;
  }
  return safe;
}

/**
 * Get the active trace ID and span ID for log correlation.
 * Returns empty strings when tracing is not active.
 */
export function getActiveTraceContext(): { traceId: string; spanId: string } {
  const span = trace.getActiveSpan();
  if (!span) return { traceId: '', spanId: '' };
  const ctx = span.spanContext();
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}
