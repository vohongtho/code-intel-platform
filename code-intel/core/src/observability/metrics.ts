/**
 * Prometheus metrics for code-intel platform.
 * Uses prom-client to expose /metrics endpoint.
 */
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// ── Singleton registry ────────────────────────────────────────────────────────

export const metricsRegistry = new Registry();

// Collect default Node.js metrics (heap, eventloop, gc, etc.)
collectDefaultMetrics({ register: metricsRegistry });

// ── Counters ──────────────────────────────────────────────────────────────────

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [metricsRegistry],
});

export const pipelineAnalysesTotal = new Counter({
  name: 'pipeline_analyses_total',
  help: 'Total number of pipeline analyses run',
  labelNames: ['status'] as const,
  registers: [metricsRegistry],
});

export const mcpToolCallsTotal = new Counter({
  name: 'mcp_tool_calls_total',
  help: 'Total number of MCP tool calls',
  labelNames: ['tool', 'status'] as const,
  registers: [metricsRegistry],
});

export const authAttemptsTotal = new Counter({
  name: 'auth_attempts_total',
  help: 'Total number of authentication attempts',
  labelNames: ['method', 'outcome'] as const,
  registers: [metricsRegistry],
});

// ── Histograms ────────────────────────────────────────────────────────────────

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

export const pipelinePhaseDurationSeconds = new Histogram({
  name: 'pipeline_phase_duration_seconds',
  help: 'Duration of individual pipeline phases in seconds',
  labelNames: ['phase', 'status'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [metricsRegistry],
});

export const mcpToolDurationSeconds = new Histogram({
  name: 'mcp_tool_duration_seconds',
  help: 'Duration of MCP tool calls in seconds',
  labelNames: ['tool'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [metricsRegistry],
});

// ── Gauges ────────────────────────────────────────────────────────────────────

export const pipelineNodesTotal = new Gauge({
  name: 'pipeline_nodes_total',
  help: 'Total number of nodes in the knowledge graph',
  labelNames: ['repo'] as const,
  registers: [metricsRegistry],
});

export const pipelineEdgesTotal = new Gauge({
  name: 'pipeline_edges_total',
  help: 'Total number of edges in the knowledge graph',
  labelNames: ['repo'] as const,
  registers: [metricsRegistry],
});

export const jobQueueDepth = new Gauge({
  name: 'job_queue_depth',
  help: 'Current number of jobs in the queue',
  labelNames: ['status'] as const,
  registers: [metricsRegistry],
});

export const activeSessionsTotal = new Gauge({
  name: 'active_sessions_total',
  help: 'Current number of active user sessions',
  registers: [metricsRegistry],
});
