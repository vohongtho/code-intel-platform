import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { doubleCsrf } from 'csrf-csrf';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { isLazyGraph } from '../graph/lazy-knowledge-graph.js';
import { textSearch } from '../search/text-search.js';
import { hybridSearch } from '../search/hybrid-search.js';
import { Bm25Index, getBm25DbPath } from '../search/bm25-index.js';
import { DbManager, getDbPath, getVectorDbPath } from '../storage/index.js';
import { loadMetadata } from '../storage/metadata.js';
import { VectorIndex } from '../search/vector-index.js';
// VectorIndex now uses better-sqlite3 directly (no DbManager needed)
import fs from 'node:fs';
import { listGroups, loadGroup, loadSyncResult, saveSyncResult } from '../multi-repo/group-registry.js';
import { syncGroup } from '../multi-repo/group-sync.js';
import { queryGroup } from '../multi-repo/group-query.js';
import { createKnowledgeGraph } from '../graph/knowledge-graph.js';
import { loadGraphFromDB } from '../multi-repo/graph-from-db.js';
import { loadRegistry } from '../storage/repo-registry.js';
import Logger from '../shared/logger.js';
import { AppError, ErrorCodes } from '../errors/codes.js';
import {
  requestIdMiddleware,
  authMiddleware,
  requireAuth,
  requireRole,
  requireRepoAccess,
  requireToolScope,
  buildSessionCookie,
  clearSessionCookie,
  createSession,
  verifyPassword,
  sessionStore,
} from '../auth/middleware.js';
import { getOrCreateUsersDB } from '../auth/users-db.js';
import type { Role } from '../auth/users-db.js';
import { getOrCreateJobsDB } from '../jobs/jobs-db.js';
import type { JobStatus } from '../jobs/jobs-db.js';
import { governanceLogger } from '../governance/llm-governance.js';
import { createBackupScheduler } from '../backup/backup-scheduler.js';
import {
  isOIDCConfigured,
  getOIDCConfig,
  getDiscoveredConfig,
  buildOIDCLoginUrl,
  handleOIDCCallback,
  deriveUsername,
  initiateDeviceFlow,
  pollDeviceFlow,
  refreshOIDCToken,
} from '../auth/oidc.js';
import {
  metricsRegistry,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  pipelineNodesTotal,
  pipelineEdgesTotal,
  activeSessionsTotal,
  authAttemptsTotal,
} from '../observability/metrics.js';
import { withSpan, isTracingEnabled } from '../observability/tracing.js';
import { openApiSpec } from './openapi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Web UI is bundled into dist/web/ at publish time.
// Fallback to the monorepo sibling path for local dev.
const WEB_DIST = (() => {
  // dist/cli/main.js → ../web = dist/web/  (global install & npm pack)
  const bundled = path.resolve(__dirname, '..', 'web');
  if (fs.existsSync(bundled)) return bundled;
  // Monorepo dev: dist/cli/ → ../../../web/dist = code-intel/web/dist
  return path.resolve(__dirname, '..', '..', '..', 'web', 'dist');
})();

// ── CORS allowed origins ──────────────────────────────────────────────────────

function getAllowedOrigins(): string[] {
  const env = process.env['CODE_INTEL_CORS_ORIGINS'];
  if (env) return env.split(',').map((s) => s.trim());
  return ['http://localhost:3000', 'http://localhost:4747', 'http://localhost:4748'];
}

// ── Rate limiters ─────────────────────────────────────────────────────────────

function createDefaultLimiter() {
  const max = parseInt(process.env['CODE_INTEL_RATE_LIMIT_MAX'] ?? '100', 10);
  const windowMs =
    parseInt(process.env['CODE_INTEL_RATE_LIMIT_WINDOW_MS'] ?? `${60 * 1000}`, 10);
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Skip health checks, metrics, and read-only listing/pagination endpoints.
    // The node pagination and group/repo listing endpoints are hit many times
    // when loading a large graph — rate-limiting them only hurts the user's own
    // session without providing meaningful abuse protection.
    skip: (req) =>
      req.path.startsWith('/health') ||
      req.path === '/metrics' ||
      req.path === '/api/v1/repos' ||
      req.path === '/api/v1/groups' ||
      req.method === 'GET' && req.path.startsWith('/api/v1/groups/') ||
      /^\/api\/v1\/graph\/[^/]+\/nodes$/.test(req.path),
    message: {
      error: {
        code: ErrorCodes.RATE_LIMIT_EXCEEDED,
        message: 'Too many requests',
        hint: 'Slow down — you are sending requests too fast. Try again later.',
      },
    },
  });
}

// ── App factory ───────────────────────────────────────────────────────────────

export function createApp(graph: KnowledgeGraph, repoName: string, workspaceRoot?: string, watcherState?: { watching: boolean; lastEventAt: number | null }): express.Application {
  const app = express();

  // Trust proxy (for correct IP detection behind nginx/caddy)
  app.set('trust proxy', 1);

  // ── Compression ─────────────────────────────────────────────────────────────
  // gzip/deflate large responses (graph JSON, search results, etc.)
  app.use(compression());

  // ── Security middleware ─────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: false, // disabled to allow Web UI to load scripts
    }),
  );
  // CORS: actively reject non-allowlisted Origins (no `*` in production).
  // Requests without an Origin header (e.g. server-side, curl) are allowed
  // through; the browser is the entity enforcing CORS, so this only matters
  // for cross-origin browser requests.
  const allowedOrigins = getAllowedOrigins();
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) { callback(null, true); return; }
        if (allowedOrigins.includes(origin)) { callback(null, true); return; }
        // Non-allowlisted origin: do not echo Access-Control-Allow-Origin
        // (browser will block the response). Server-side request still
        // proceeds so we can return a normal 403/401 from downstream handlers.
        callback(null, false);
      },
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(createDefaultLimiter());

  // ── CSRF protection setup ───────────────────────────────────────────────────
  const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
    getSecret: () => process.env['CODE_INTEL_CSRF_SECRET'] ?? 'csrf-secret-change-in-production',
    getSessionIdentifier: (req) => {
      // Use the session cookie value or IP as the session identifier
      const cookieHeader = req.headers['cookie'] ?? '';
      const match = cookieHeader.match(/code_intel_session=([^;]+)/);
      return match ? decodeURIComponent(match[1] ?? '') : (req.ip ?? 'anonymous');
    },
    cookieName: process.env['NODE_ENV'] === 'production' ? '__Host-csrf-token' : 'csrf-token',
    cookieOptions: {
      sameSite: 'strict',
      path: '/',
      secure: process.env['NODE_ENV'] === 'production',
      httpOnly: true,
    },
    size: 64,
    getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'],
  });

  // ── Request ID + Auth middleware ────────────────────────────────────────────
  app.use(requestIdMiddleware);
  app.use(authMiddleware);

  // ── X-Index-Version + X-Stale headers on every response (Epic 6) ────────────
  // If the DB/meta becomes unavailable, we still serve the in-memory graph (stale)
  // and advertise it with X-Stale: true + X-Stale-Since: <ISO timestamp>.
  let dbUnavailableSince: string | null = null;

  app.use((_req: Request, res: Response, next: NextFunction): void => {
    if (workspaceRoot) {
      // Use a raw read so corrupted or unreadable files throw (loadMetadata swallows errors)
      const metaFilePath = path.join(workspaceRoot, '.code-intel', 'meta.json');
      let metaOk = false;
      try {
        if (fs.existsSync(metaFilePath)) {
          const raw = fs.readFileSync(metaFilePath, 'utf-8');
          const meta = JSON.parse(raw) as { indexVersion?: string } | null;
          if (meta?.indexVersion) res.setHeader('X-Index-Version', meta.indexVersion);
        }
        metaOk = true;
        // If we previously flagged DB unavailability, clear it now
        if (dbUnavailableSince !== null) {
          dbUnavailableSince = null;
          Logger.info('[serve] DB back online — cleared stale flag');
        }
      } catch (err) {
        // DB/meta temporarily unavailable — flag it and serve stale graph
        if (dbUnavailableSince === null) {
          dbUnavailableSince = new Date().toISOString();
          Logger.warn(`[serve] DB unavailable since ${dbUnavailableSince}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (!metaOk) {
        res.setHeader('X-Stale', 'true');
        res.setHeader('X-Stale-Since', dbUnavailableSince!);
      }
    }
    next();
  });

  // ── Audit log: every authenticated request ──────────────────────────────────
  // Writes an entry to the audit_log table on response finish.
  // Skips /health/* and /metrics (high-frequency, unauthenticated).
  app.use((req: Request, res: Response, next: NextFunction): void => {
    res.on('finish', () => {
      if (!req.user) return; // unauthenticated requests are not audited here
      if (req.path.startsWith('/health') || req.path === '/metrics') return;
      const outcome: 'allow' | 'deny' = res.statusCode < 400 ? 'allow' : 'deny';
      try {
        const db = getOrCreateUsersDB();
        db.logAccess(req.user.id, req.path, req.method, outcome, req.ip ?? 'unknown');
      } catch { /* never throw from audit — it must not affect the response */ }
    });
    next();
  });

  // ── HTTP metrics + OTel span per request ────────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();
    if (isTracingEnabled()) {
      // Import is already cached after the first call
      void import('../observability/tracing.js').then(({ getTracer, sanitizeAttrs: sa }) => {
        const span = getTracer().startSpan(`HTTP ${req.method} ${req.path}`, {
          attributes: sa({
            'http.method': req.method,
            'http.url': req.path,
            'http.request_id': req.requestId ?? '',
          }),
        });
        res.on('finish', () => {
          const route = req.route?.path ?? req.path ?? 'unknown';
          const method = req.method;
          const statusCode = String(res.statusCode);
          const durationSec = (Date.now() - start) / 1000;
          httpRequestsTotal.inc({ method, route, status_code: statusCode });
          httpRequestDurationSeconds.observe({ method, route, status_code: statusCode }, durationSec);
          span.setAttribute('http.status_code', res.statusCode);
          span.setAttribute('http.route', route);
          span.end();
        });
      });
    } else {
      res.on('finish', () => {
        const route = req.route?.path ?? req.path ?? 'unknown';
        const method = req.method;
        const statusCode = String(res.statusCode);
        const durationSec = (Date.now() - start) / 1000;
        httpRequestsTotal.inc({ method, route, status_code: statusCode });
        httpRequestDurationSeconds.observe({ method, route, status_code: statusCode }, durationSec);
      });
    }
    next();
  });

  // ── Lazy-init vector index ──────────────────────────────────────────────────
  let vectorIndex: VectorIndex | null = null;
  let vectorIndexBuilding = false;
  let vectorIndexReady = false;

  // ── BM25 pre-built inverted index (Epic 2) ──────────────────────────────────
  let bm25Index: Bm25Index | null = null;

  function ensureBm25Index(): Bm25Index | null {
    if (bm25Index) return bm25Index;
    if (!workspaceRoot) return null;
    const idx = new Bm25Index(getBm25DbPath(workspaceRoot));
    idx.load();
    if (idx.isLoaded) {
      bm25Index = idx;
      return idx;
    }
    return null;
  }

  // Load BM25 index on startup (non-blocking)
  if (workspaceRoot && process.env['NODE_ENV'] !== 'test') {
    setImmediate(() => ensureBm25Index());
  }

  async function ensureVectorIndex(): Promise<VectorIndex | null> {
    if (vectorIndexReady && vectorIndex) return vectorIndex;
    if (!workspaceRoot || vectorIndexBuilding) return null;
    vectorIndexBuilding = true;
    try {
      const { embedNodes } = await import('../search/embedder.js');
      const vdbPath = getVectorDbPath(workspaceRoot);
      const idx = new VectorIndex(vdbPath);
      await idx.init();
      const alreadyBuilt = await idx.isBuilt();
      if (!alreadyBuilt) {
        Logger.info('  [vector] Building embeddings…');
        const nodes = await embedNodes(graph, {
          onProgress: (done, total) => {
            if (done % 50 === 0 || done === total) process.stdout.write(`\r  [vector] ${done}/${total}`);
          },
        });
        Logger.info('');
        await idx.buildIndex(nodes);
        Logger.info(`  [vector] Index built: ${nodes.length} embeddings`);
      } else {
        Logger.info('  [vector] Index already exists, skipping rebuild.');
      }
      vectorIndex = idx;
      vectorIndexReady = true;
      return idx;
    } catch (err) {
      Logger.warn('  [vector] Index build failed:', err instanceof Error ? err.message : err);
      return null;
    } finally {
      vectorIndexBuilding = false;
    }
  }

  if (workspaceRoot && process.env['NODE_ENV'] !== 'test') {
    setImmediate(() => ensureVectorIndex().catch(() => {}));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC routes (no auth required)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Prometheus metrics ──────────────────────────────────────────────────────

  app.get('/metrics', async (_req, res) => {
    try {
      // Update live gauges before scrape
      pipelineNodesTotal.set({ repo: repoName }, graph.size.nodes);
      pipelineEdgesTotal.set({ repo: repoName }, graph.size.edges);
      activeSessionsTotal.set(sessionStore.size);
      const output = await metricsRegistry.metrics();
      res.set('Content-Type', metricsRegistry.contentType);
      res.end(output);
    } catch (err) {
      res.status(500).end(String(err));
    }
  });

  // ── Health checks ───────────────────────────────────────────────────────────

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/health/ready', (_req, res) => {
    if (graph.size.nodes === 0 && workspaceRoot) {
      res.status(503).json({ status: 'error', reason: 'Index not loaded yet' });
      return;
    }
    res.json({
      status: 'ok',
      nodes: graph.size.nodes,
      edges: graph.size.edges,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/health/startup', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── Auth routes ─────────────────────────────────────────────────────────────

  // Public CSRF token endpoint — clients must call this first
  app.get('/auth/csrf-token', (req, res) => {
    const token = generateCsrfToken(req, res);
    res.json({ csrfToken: token });
  });

  // Bootstrap status — tells UI whether first-run setup is needed
  app.get('/auth/bootstrap-status', (_req, res) => {
    const db = getOrCreateUsersDB();
    res.json({ needsBootstrap: !db.hasAnyUser() });
  });

  // Apply CSRF protection to all state-changing routes
  app.use(doubleCsrfProtection);

  // Bootstrap — create first admin (only works when no users exist)
  app.post('/auth/bootstrap', async (req: Request, res: Response) => {
    const db = getOrCreateUsersDB();
    if (db.hasAnyUser()) {
      res.status(400).json({
        error: {
          code: 'CI-1004',
          message: 'Bootstrap already completed',
          hint: 'An admin account already exists. Use /auth/login instead.',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password || password.length < 8) {
      res.status(400).json({
        error: {
          code: ErrorCodes.INVALID_REQUEST,
          message: 'username and password (min 8 chars) are required',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    const user = db.createUser(username, password, 'admin');
    const sessionId = createSession({ id: user.id, username: user.username, role: user.role });
    res.setHeader('Set-Cookie', buildSessionCookie(sessionId));
    res.status(201).json({ user: { id: user.id, username: user.username, role: user.role } });
  });

  app.post('/auth/login', async (req: Request, res: Response) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({
        error: {
          code: ErrorCodes.INVALID_REQUEST,
          message: 'username and password are required',
          hint: 'Provide { "username": "...", "password": "..." } in request body',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const db = getOrCreateUsersDB();
    const user = db.findUserByUsername(username);

    if (!user) {
      db.logAccess('unknown', `/auth/login`, 'login', 'deny', req.ip ?? 'unknown');
      authAttemptsTotal.inc({ method: 'local', outcome: 'failure' });
      res.status(401).json({
        error: {
          code: ErrorCodes.UNAUTHORIZED,
          message: 'Invalid username or password',
          hint: 'Check your credentials and try again',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      db.logAccess(user.id, `/auth/login`, 'login', 'deny', req.ip ?? 'unknown');
      authAttemptsTotal.inc({ method: 'local', outcome: 'failure' });
      res.status(401).json({
        error: {
          code: ErrorCodes.UNAUTHORIZED,
          message: 'Invalid username or password',
          hint: 'Check your credentials and try again',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const sessionId = createSession({ id: user.id, username: user.username, role: user.role });
    db.logAccess(user.id, '/auth/login', 'login', 'allow', req.ip ?? 'unknown');
    authAttemptsTotal.inc({ method: 'local', outcome: 'success' });
    res.setHeader('Set-Cookie', buildSessionCookie(sessionId));
    res.json({ user: { id: user.id, username: user.username, role: user.role } });
  });

  app.post('/auth/logout', (req: Request, res: Response) => {
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.json({ message: 'Logged out successfully' });
  });

  app.get('/auth/status', (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401).json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      user: { id: req.user.id, username: req.user.username, role: req.user.role },
      authMethod: req.user.authMethod,
    });
  });

  // ── OIDC / OAuth2 routes (1.3) ──────────────────────────────────────────────

  // Probe: is OIDC configured?
  app.get('/auth/oidc/status', async (_req, res) => {
    if (!isOIDCConfigured()) {
      res.json({ enabled: false });
      return;
    }
    const cfg = getOIDCConfig()!;
    // Attempt discovery to confirm provider is reachable
    const discovered = await getDiscoveredConfig();
    res.json({
      enabled: true,
      issuer: cfg.issuer,
      reachable: discovered !== null,
    });
  });

  // Step 1: redirect to provider
  app.get('/auth/oidc/login', async (req: Request, res: Response) => {
    if (!isOIDCConfigured()) {
      res.status(503).json({
        error: {
          code: 'CI-1005',
          message: 'OIDC is not configured',
          hint: 'Set CODE_INTEL_OIDC_ISSUER, CODE_INTEL_OIDC_CLIENT_ID, CODE_INTEL_OIDC_CLIENT_SECRET env vars',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    try {
      const result = await buildOIDCLoginUrl();
      if (!result) {
        res.status(503).json({
          error: {
            code: 'CI-1005',
            message: 'OIDC provider unreachable',
            hint: 'The OIDC issuer could not be reached. Check CODE_INTEL_OIDC_ISSUER and network connectivity.',
            requestId: req.requestId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }
      res.redirect(302, result.redirectUrl);
    } catch (err) {
      Logger.warn('[oidc] Login redirect failed:', err instanceof Error ? err.message : err);
      res.status(500).json({
        error: {
          code: 'CI-5000',
          message: 'OIDC login initiation failed',
          hint: err instanceof Error ? err.message : 'Unknown error',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  // Step 2: provider redirects back here with code + state
  app.get('/auth/callback', async (req: Request, res: Response) => {
    const { state, error, error_description } = req.query as Record<string, string | undefined>;

    // Provider error (e.g. user denied)
    if (error) {
      Logger.warn('[oidc] Provider returned error:', error, error_description);
      res.redirect(302, `/?oidc_error=${encodeURIComponent(error_description ?? error)}`);
      return;
    }

    if (!state) {
      res.status(400).json({
        error: {
          code: 'CI-1200',
          message: 'Missing state parameter in OIDC callback',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    try {
      const currentUrl = new URL(
        req.originalUrl,
        getOIDCConfig()?.redirectUri ?? `http://localhost:4747`,
      );
      const { userInfo } = await handleOIDCCallback(currentUrl, state);

      // Determine provider from issuer
      const cfg = getOIDCConfig()!;
      const provider = cfg.issuer;

      const db = getOrCreateUsersDB();

      // Find or provision user
      let user = db.findUserByOIDC(provider, userInfo.sub);
      if (user) {
        // Existing user — update last login
        db.touchOIDCIdentity(provider, userInfo.sub);
        authAttemptsTotal.inc({ method: 'oidc', outcome: 'success' });
      } else {
        // New user — auto-provision with default role
        const username = deriveUsername(userInfo);
        // Ensure username uniqueness by appending a suffix if needed
        let finalUsername = username;
        let suffix = 1;
        while (db.findUserByUsername(finalUsername)) {
          finalUsername = `${username}_${suffix++}`;
        }
        const { user: newUser } = db.provisionOIDCUser(
          finalUsername,
          cfg.defaultRole,
          provider,
          userInfo.sub,
          userInfo.email,
          userInfo.name,
        );
        user = { ...newUser, oidcIdentityId: '' };
        authAttemptsTotal.inc({ method: 'oidc', outcome: 'success' });
        Logger.info(`[oidc] Auto-provisioned new user: ${finalUsername} (${cfg.defaultRole})`);
      }

      const sessionId = createSession({ id: user.id, username: user.username, role: user.role });
      db.logAccess(user.id, '/auth/callback', 'oidc-login', 'allow', req.ip ?? 'unknown');
      res.setHeader('Set-Cookie', buildSessionCookie(sessionId));
      // Redirect back to the web UI
      res.redirect(302, '/');
    } catch (err) {
      Logger.warn('[oidc] Callback failed:', err instanceof Error ? err.message : err);
      authAttemptsTotal.inc({ method: 'oidc', outcome: 'failure' });
      const msg = err instanceof Error ? err.message : 'OIDC callback failed';
      res.redirect(302, `/?oidc_error=${encodeURIComponent(msg)}`);
    }
  });

  // OIDC refresh — called by clients with a stored OIDC refresh token
  app.post('/auth/oidc/refresh', async (req: Request, res: Response) => {
    const { refresh_token } = req.body as { refresh_token?: string };
    if (!refresh_token) {
      res.status(400).json({
        error: {
          code: 'CI-1200',
          message: 'refresh_token required',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    const result = await refreshOIDCToken(refresh_token);
    if (!result) {
      res.status(401).json({
        error: {
          code: 'CI-1000',
          message: 'Refresh token invalid or OIDC provider unreachable',
          hint: 'Re-login via /auth/oidc/login',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    res.json(result);
  });

  // Fallback: OIDC unavailable → redirect to local login
  app.get('/auth/oidc/fallback', (_req, res) => {
    res.redirect(302, '/login');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PROTECTED routes — require authentication
  // ═══════════════════════════════════════════════════════════════════════════

  app.use('/api/v1', requireAuth);

  // ── Legacy /api/* → redirect to /api/v1/* ──────────────────────────────────
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/v1')) {
      res.redirect(301, `/api/v1${req.path}`);
      return;
    }
    next();
  });

  // ── OpenAPI spec + Swagger UI (dev only) ────────────────────────────────────
  app.get('/api/v1/openapi.json', (_req, res) => {
    res.json(openApiSpec);
  });

  if (process.env['NODE_ENV'] !== 'production') {
    app.get('/api/v1/docs', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Code Intel API Docs</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" >
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"> </script>
  <script>
    SwaggerUIBundle({
      url: "/api/v1/openapi.json",
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "BaseLayout"
    })
  </script>
</body>
</html>`);
    });
  }

  // ── Health (detailed) ───────────────────────────────────────────────────────
  app.get('/api/v1/health', (req: Request, res: Response) => {
    const db = getOrCreateUsersDB();
    const memUsage = process.memoryUsage();
    res.json({
      status: 'ok',
      nodes: graph.size.nodes,
      edges: graph.size.edges,
      users: db.hasAnyUser(),
      workspaceRoot,
      watching: watcherState?.watching ?? false,
      lastWatchEvent: watcherState?.lastEventAt
        ? new Date(watcherState.lastEventAt).toISOString()
        : null,
      memory: {
        heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
        rssMb: Math.round(memUsage.rss / 1024 / 1024),
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    });
  });

  // ── Repos ───────────────────────────────────────────────────────────────────
  app.get('/api/v1/repos', (_req, res) => {
    const registry = loadRegistry();
    if (registry.length === 0) {
      res.json([{ name: repoName, path: workspaceRoot ?? '', nodes: graph.size.nodes, edges: graph.size.edges, indexedAt: null }]);
      return;
    }
    res.json(registry.map((r) => ({
      name: r.name,
      path: r.path,
      nodes: r.stats.nodes,
      edges: r.stats.edges,
      indexedAt: r.indexedAt,
      active: r.path === workspaceRoot,
    })));
  });

  // ── Graph helpers ───────────────────────────────────────────────────────────
  async function loadRepoGraph(requestedRepo: string): Promise<KnowledgeGraph | null> {
    if (requestedRepo === repoName) return graph;
    const registry = loadRegistry();
    const entry = registry.find((r) => r.name === requestedRepo || r.path === requestedRepo);
    if (!entry) return null;
    const dbPath = path.join(entry.path, '.code-intel', 'graph.db');
    if (!fs.existsSync(dbPath)) return null;
    const repoGraph = createKnowledgeGraph();
    const db = new DbManager(dbPath, true);
    try {
      await db.init();
      await loadGraphFromDB(repoGraph, db);
      db.close();
      return repoGraph;
    } catch {
      db.close();
      return null;
    }
  }

  async function getGraphForRepo(requestedRepo: string | undefined): Promise<KnowledgeGraph> {
    if (!requestedRepo || requestedRepo === repoName) return graph;
    const g = await loadRepoGraph(requestedRepo);
    return g ?? graph;
  }

  // ── Graph download ──────────────────────────────────────────────────────────
  app.get('/api/v1/graph/:repo', requireRepoAccess((req) => {
    const p = req.params['repo'];
    const repo = Array.isArray(p) ? p[0] : p;
    return repo ? decodeURIComponent(repo) : undefined;
  }), async (req, res) => {
    const rawRepo = req.params['repo'];
    const requestedRepo = decodeURIComponent(Array.isArray(rawRepo) ? (rawRepo[0] ?? '') : (rawRepo ?? ''));
    const g = await loadRepoGraph(requestedRepo);
    if (!g) {
      res.status(404).json({
        error: {
          code: ErrorCodes.NOT_FOUND,
          message: `Repo "${requestedRepo}" not found or not indexed`,
          hint: `Run: code-intel analyze <path>`,
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    res.json({ nodes: [...g.allNodes()], edges: [...g.allEdges()] });
  });

  // ── Paginated node list (Epic 1.2) ──────────────────────────────────────────
  // GET /api/v1/graph/:repo/nodes?limit=200&offset=0
  // Returns a page of nodes. In lazy mode uses native SKIP/LIMIT; eager mode slices an array.
  app.get('/api/v1/graph/:repo/nodes', requireRepoAccess((req) => {
    const p = req.params['repo'];
    const repo = Array.isArray(p) ? p[0] : p;
    return repo ? decodeURIComponent(repo) : undefined;
  }), async (req, res) => {
    const rawRepo = req.params['repo'];
    const requestedRepo = decodeURIComponent(Array.isArray(rawRepo) ? (rawRepo[0] ?? '') : (rawRepo ?? ''));
    const limit = Math.min(parseInt((req.query['limit'] as string | undefined) ?? '200', 10), 1000);
    const offset = Math.max(parseInt((req.query['offset'] as string | undefined) ?? '0', 10), 0);

    const g = requestedRepo === repoName ? graph : await loadRepoGraph(requestedRepo);
    if (!g) {
      res.status(404).json({
        error: {
          code: ErrorCodes.NOT_FOUND,
          message: `Repo "${requestedRepo}" not found or not indexed`,
          hint: `Run: code-intel analyze <path>`,
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    let nodes: import('../shared/index.js').CodeNode[];
    if (isLazyGraph(g)) {
      // Lazy mode: native SKIP/LIMIT — O(1) regardless of offset
      nodes = await g.getNodePage(offset, limit);
    } else {
      // Eager mode: build array once, cache on graph object, then slice — O(1) per page
      const eager = g as typeof g & { _nodeArray?: import('../shared/index.js').CodeNode[] };
      if (!eager._nodeArray) {
        eager._nodeArray = [...g.allNodes()];
      }
      nodes = eager._nodeArray.slice(offset, offset + limit);
    }

    res.json({
      nodes,
      offset,
      limit,
      total: g.size.nodes,
      hasMore: offset + nodes.length < g.size.nodes,
    });
  });

  // ── Search ──────────────────────────────────────────────────────────────────
  app.post('/api/v1/search', requireToolScope('search'), async (req, res) => {
    const { query, limit, repo } = req.body as { query?: string; limit?: number; repo?: string };
    const g = await getGraphForRepo(repo);
    const vdbPath = workspaceRoot ? getVectorDbPath(workspaceRoot) : undefined;

    // Use pre-built BM25 index when available and querying the current repo
    const bm25 = (!repo || repo === repoName) ? ensureBm25Index() : null;
    const bm25Results = bm25 ? bm25.search(query ?? '', (limit ?? 20) * 3) : null;

    const { results, searchMode } = await hybridSearch(g, query ?? '', limit ?? 20, {
      vectorDbPath: vdbPath,
      bm25Results: bm25Results ?? undefined,
    });
    res.json({ results, searchMode });
  });

  // ── Vector search ───────────────────────────────────────────────────────────
  app.post('/api/v1/vector-search', async (req, res) => {
    const { query, limit = 10 } = req.body as { query?: string; limit?: number };
    if (!query) { res.status(400).json({ error: { code: ErrorCodes.INVALID_REQUEST, message: 'Missing query', hint: 'Provide { "query": "..." } in request body' } }); return; }
    const idx = await ensureVectorIndex();
    if (!idx) {
      const results = textSearch(graph, query, limit);
      res.json({ results, source: 'text-fallback', vectorReady: false });
      return;
    }
    try {
      const { pipeline } = await import('@huggingface/transformers');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const embedder = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')) as unknown as (text: string, opts: Record<string, unknown>) => Promise<{ data: Float32Array }>;
      const out = await embedder(query, { pooling: 'mean', normalize: true });
      const queryEmbedding = Array.from(out.data);
      const hits = await idx.search(queryEmbedding, limit);
      res.json({ results: hits.map((h) => ({ nodeId: h.nodeId, name: h.name, kind: h.kind, filePath: h.filePath, score: h.score })), source: 'vector', vectorReady: true });
    } catch (err) {
      const results = textSearch(graph, query, limit);
      res.json({ results, source: 'text-fallback', vectorReady: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Vector status ───────────────────────────────────────────────────────────
  app.get('/api/v1/vector-status', (_req, res) => {
    res.json({ ready: vectorIndexReady, building: vectorIndexBuilding });
  });

  // ── File read ───────────────────────────────────────────────────────────────
  app.post('/api/v1/files/read', requireToolScope('read_file'), (req, res) => {
    const { file_path } = req.body as { file_path?: string };
    if (!file_path) { res.status(400).json({ error: { code: ErrorCodes.INVALID_REQUEST, message: 'Missing file_path' } }); return; }
    // Security: must be within a known repo path
    const registry = loadRegistry();
    const isAllowed = workspaceRoot
      ? file_path.startsWith(workspaceRoot)
      : registry.some((r) => file_path.startsWith(r.path));
    if (!isAllowed) {
      res.status(403).json({ error: { code: ErrorCodes.FORBIDDEN, message: 'Access denied', hint: 'File path must be within an indexed repository' } });
      return;
    }
    try {
      const content = fs.readFileSync(file_path, 'utf-8');
      res.json({ content });
    } catch {
      res.status(404).json({ error: { code: ErrorCodes.NOT_FOUND, message: 'File not found' } });
    }
  });

  // ── Grep ────────────────────────────────────────────────────────────────────
  app.post('/api/v1/grep', requireToolScope('grep'), (req, res) => {
    const { pattern, file_paths } = req.body as { pattern?: string; file_paths?: string[] };
    const results: { file: string; line: number; text: string }[] = [];
    try {
      const regex = new RegExp(pattern ?? '', 'gi');
      const paths: string[] = file_paths ?? [];
      if (paths.length === 0) {
        for (const node of graph.allNodes()) {
          if (node.kind === 'file' && node.content) {
            const lines = node.content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i]!)) results.push({ file: node.filePath, line: i + 1, text: lines[i]!.trim() });
              regex.lastIndex = 0;
            }
          }
        }
      }
      res.json({ results: results.slice(0, 100) });
    } catch {
      res.status(400).json({ error: { code: ErrorCodes.INVALID_REQUEST, message: 'Invalid regex pattern' } });
    }
  });

  // ── Cypher query ────────────────────────────────────────────────────────────
  app.post('/api/v1/cypher', async (req, res) => {
    const { query: q } = req.body as { query?: string };
    if (!q) { res.status(400).json({ error: { code: ErrorCodes.INVALID_REQUEST, message: 'Missing query' } }); return; }
    if (workspaceRoot) {
      try {
        const dbPath = getDbPath(workspaceRoot);
        const dbm = new DbManager(dbPath, true);
        await dbm.init();
        const rows = await dbm.query(q);
        dbm.close();
        res.json({ results: rows });
        return;
      } catch { /* fall through */ }
    }
    try {
      const nameMatch = q.match(/name\s*=\s*['"]([^'"]+)['"]/i);
      if (nameMatch) {
        const name = nameMatch[1];
        const results = [];
        for (const node of graph.allNodes()) {
          if (node.name === name) {
            results.push({ node, incoming: [...graph.findEdgesTo(node.id)].length, outgoing: [...graph.findEdgesFrom(node.id)].length });
          }
        }
        res.json({ results });
        return;
      }
      const kindMatch = q.match(/:\s*(\w+)/);
      if (kindMatch) {
        const kind = kindMatch[1];
        const results = [];
        for (const node of graph.allNodes()) {
          if (node.kind === kind) results.push(node);
          if (results.length >= 50) break;
        }
        res.json({ results });
        return;
      }
      res.json({ results: [], message: 'Query not recognized.' });
    } catch {
      res.status(400).json({ error: { code: ErrorCodes.INVALID_REQUEST, message: 'Invalid query' } });
    }
  });

  // ── Node detail ─────────────────────────────────────────────────────────────
  app.get('/api/v1/nodes/:id', async (req, res) => {
    const nodeId = decodeURIComponent(req.params.id);
    const g = await getGraphForRepo(req.query['repo'] as string | undefined);
    // In lazy mode, fall through to DB if node is not in LRU cache
    const node = isLazyGraph(g)
      ? await g.getNodeAsync(nodeId)
      : g.getNode(nodeId);
    if (!node) {
      res.status(404).json({ error: { code: ErrorCodes.NOT_FOUND, message: 'Node not found', requestId: req.requestId } });
      return;
    }
    const incoming = [...g.findEdgesTo(nodeId)];
    const outgoing = [...g.findEdgesFrom(nodeId)];
    // In lazy mode, resolve neighbor names from cache/DB
    const resolveName = isLazyGraph(g)
      ? async (id: string) => {
          const n = g.getNode(id) ?? await g.getNodeAsync(id);
          return n?.name;
        }
      : (id: string) => Promise.resolve(g.getNode(id)?.name);
    const resolveKind = isLazyGraph(g)
      ? async (id: string) => {
          const n = g.getNode(id) ?? await g.getNodeAsync(id);
          return n?.kind;
        }
      : (id: string) => Promise.resolve(g.getNode(id)?.kind);

    res.json({
      node,
      callers: await Promise.all(incoming.filter((e) => e.kind === 'calls').map(async (e) => ({ id: e.source, name: await resolveName(e.source), weight: e.weight }))),
      callees: await Promise.all(outgoing.filter((e) => e.kind === 'calls').map(async (e) => ({ id: e.target, name: await resolveName(e.target), weight: e.weight }))),
      imports: await Promise.all(outgoing.filter((e) => e.kind === 'imports').map(async (e) => ({ id: e.target, name: await resolveName(e.target) }))),
      importedBy: await Promise.all(incoming.filter((e) => e.kind === 'imports').map(async (e) => ({ id: e.source, name: await resolveName(e.source) }))),
      extends: await Promise.all(outgoing.filter((e) => e.kind === 'extends').map(async (e) => ({ id: e.target, name: await resolveName(e.target) }))),
      implementsEdges: await Promise.all(outgoing.filter((e) => e.kind === 'implements').map(async (e) => ({ id: e.target, name: await resolveName(e.target) }))),
      members: await Promise.all(outgoing.filter((e) => e.kind === 'has_member').map(async (e) => ({ id: e.target, name: await resolveName(e.target), kind: await resolveKind(e.target) }))),
      cluster: (await Promise.all(incoming.filter((e) => e.kind === 'belongs_to').map(async (e) => resolveName(e.target))))[0],
    });
  });

  // ── Blast radius ────────────────────────────────────────────────────────────
  app.post('/api/v1/blast-radius', async (req, res) => {
    const { target, direction = 'both', max_hops = 5, repo } = req.body as { target?: string; direction?: string; max_hops?: number; repo?: string };
    const g = await getGraphForRepo(repo);
    let targetNode = null;
    if (isLazyGraph(g) && target) {
      // Lazy mode: search by ID first (fast), then stream all nodes if needed
      targetNode = g.getNode(target) ?? await g.getNodeAsync(target) ?? null;
      if (!targetNode) {
        for await (const node of g.allNodesAsync()) {
          if (node.name === target || node.id === target) { targetNode = node; break; }
        }
      }
    } else {
      for (const node of g.allNodes()) {
        if (node.name === target || node.id === target) { targetNode = node; break; }
      }
    }
    if (!targetNode) {
      res.status(404).json({ error: { code: ErrorCodes.NOT_FOUND, message: `Symbol "${target}" not found`, requestId: req.requestId } });
      return;
    }
    const affected = new Map<string, { name: string; kind: string; depth: number }>();
    const queue: { id: string; depth: number }[] = [{ id: targetNode.id, depth: 0 }];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id) || depth > max_hops) continue;
      visited.add(id);
      const node = g.getNode(id);
      if (node) affected.set(id, { name: node.name, kind: node.kind, depth });
      if (direction === 'callers' || direction === 'both') {
        for (const edge of g.findEdgesTo(id)) {
          if (edge.kind === 'calls' || edge.kind === 'imports') queue.push({ id: edge.source, depth: depth + 1 });
        }
      }
      if (direction === 'callees' || direction === 'both') {
        for (const edge of g.findEdgesFrom(id)) {
          if (edge.kind === 'calls' || edge.kind === 'imports') queue.push({ id: edge.target, depth: depth + 1 });
        }
      }
    }
    res.json({
      target: targetNode.name,
      affectedCount: [...affected.values()].filter((a) => a.depth > 0).length,
      affected: [...affected.entries()].map(([id, info]) => ({ id, ...info })).filter((a) => a.depth > 0),
    });
  });

  // ── Flows ───────────────────────────────────────────────────────────────────
  app.get('/api/v1/flows', async (req, res) => {
    const g = await getGraphForRepo(req.query['repo'] as string | undefined);
    const flows: { id: string; name: string; steps: unknown }[] = [];
    for (const node of g.allNodes()) {
      if (node.kind === 'flow') flows.push({ id: node.id, name: node.name, steps: node.metadata?.steps });
    }
    res.json({ flows });
  });

  // ── Clusters ────────────────────────────────────────────────────────────────
  app.get('/api/v1/clusters', async (req, res) => {
    const g = await getGraphForRepo(req.query['repo'] as string | undefined);
    const clusters: { id: string; name: string; memberCount: number }[] = [];
    for (const node of g.allNodes()) {
      if (node.kind === 'cluster') clusters.push({ id: node.id, name: node.name, memberCount: (node.metadata?.memberCount as number) ?? 0 });
    }
    res.json({ clusters });
  });

  // ── Jobs ────────────────────────────────────────────────────────────────────
  app.get('/api/v1/jobs', (req: Request, res: Response) => {
    const { status, repo } = req.query as { status?: string; repo?: string };
    const jobsDB = getOrCreateJobsDB();
    const filters: { status?: JobStatus; repoPath?: string } = {};
    if (status) filters.status = status as JobStatus;
    if (repo) filters.repoPath = repo;
    const jobs = jobsDB.listJobs(filters);
    res.json({ jobs });
  });

  app.delete('/api/v1/jobs/:id', (req: Request, res: Response) => {
    const jobsDB = getOrCreateJobsDB();
    const { id } = req.params;
    const job = jobsDB.getJob(id as string);
    if (!job) {
      res.status(404).json({
        error: {
          code: ErrorCodes.NOT_FOUND,
          message: `Job "${id}" not found`,
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    const cancelled = jobsDB.cancel(id as string);
    if (cancelled) {
      res.json({ message: `Job "${id}" cancelled`, id });
    } else {
      res.status(409).json({
        error: {
          code: ErrorCodes.INVALID_REQUEST,
          message: `Job "${id}" cannot be cancelled (status: ${job.status})`,
          hint: 'Only pending or running jobs can be cancelled',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  // ── Groups ──────────────────────────────────────────────────────────────────
  app.get('/api/v1/groups', (_req, res) => {
    const groups = listGroups();
    res.json(groups.map((g) => ({ name: g.name, memberCount: g.members.length, lastSync: g.lastSync ?? null, createdAt: g.createdAt })));
  });

  app.get('/api/v1/groups/:name', (req, res) => {
    const group = loadGroup(req.params.name);
    if (!group) { res.status(404).json({ error: { code: ErrorCodes.NOT_FOUND, message: 'Group not found' } }); return; }
    res.json(group);
  });

  app.get('/api/v1/groups/:name/contracts', (req, res) => {
    const result = loadSyncResult(req.params.name);
    if (!result) { res.status(404).json({ error: { code: ErrorCodes.NOT_FOUND, message: 'No sync result. Run sync first.' } }); return; }
    res.json(result);
  });

  app.post('/api/v1/groups/:name/sync', async (req, res) => {
    const group = loadGroup(req.params.name);
    if (!group) { res.status(404).json({ error: { code: ErrorCodes.NOT_FOUND, message: 'Group not found' } }); return; }
    try {
      const result = await syncGroup(group);
      saveSyncResult(result);
      group.lastSync = result.syncedAt;
      const { saveGroup } = await import('../multi-repo/group-registry.js');
      saveGroup(group);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: { code: ErrorCodes.INTERNAL_ERROR, message: err instanceof Error ? err.message : String(err) } });
    }
  });

  app.post('/api/v1/groups/:name/search', async (req, res) => {
    const group = loadGroup(req.params.name);
    if (!group) { res.status(404).json({ error: { code: ErrorCodes.NOT_FOUND, message: 'Group not found' } }); return; }
    const { q, limit = 20 } = req.body as { q?: string; limit?: number };
    if (!q) { res.status(400).json({ error: { code: ErrorCodes.INVALID_REQUEST, message: 'Missing query q' } }); return; }
    try {
      const { perRepo, merged } = await queryGroup(group, q, limit);
      res.json({ perRepo, merged });
    } catch (err) {
      res.status(500).json({ error: { code: ErrorCodes.INTERNAL_ERROR, message: err instanceof Error ? err.message : String(err) } });
    }
  });

  app.get('/api/v1/groups/:name/graph', async (req, res) => {
    const group = loadGroup(req.params.name);
    if (!group) { res.status(404).json({ error: { code: ErrorCodes.NOT_FOUND, message: 'Group not found' } }); return; }
    const registry = loadRegistry();
    const mergedGraph = createKnowledgeGraph();
    for (const member of group.members) {
      const regEntry = registry.find((r) => r.name === member.registryName);
      if (!regEntry) continue;
      const dbPath = path.join(regEntry.path, '.code-intel', 'graph.db');
      if (!fs.existsSync(dbPath)) continue;
      const db = new DbManager(dbPath, true);
      try {
        await db.init();
        await loadGraphFromDB(mergedGraph, db);
        db.close();
      } catch { db.close(); }
    }
    res.json({ nodes: [...mergedGraph.allNodes()], edges: [...mergedGraph.allEdges()] });
  });

  app.get('/api/v1/groups/:name/topology', requireAuth, requireRole('viewer'), async (req: Request, res: Response) => {
    const groupName = req.params['name'] as string;
    const group = loadGroup(groupName);
    if (!group) { res.status(404).json({ error: { code: ErrorCodes.NOT_FOUND, message: 'Group not found' } }); return; }
    const syncResult = loadSyncResult(groupName);
    const registry = loadRegistry();

    const repos = await Promise.all(group.members.map(async (member) => {
      const regEntry = registry.find((r) => r.name === member.registryName);
      let nodeCount = 0;
      let edgeCount = 0;
      if (regEntry) {
        const dbPath = path.join(regEntry.path, '.code-intel', 'graph.db');
        if (fs.existsSync(dbPath)) {
          try {
            const db = new DbManager(dbPath, true);
            await db.init();
            const g = createKnowledgeGraph();
            await loadGraphFromDB(g, db);
            db.close();
            nodeCount = g.size.nodes;
            edgeCount = g.size.edges;
          } catch { /* ignore */ }
        }
      }
      return { name: member.registryName, groupPath: member.groupPath, nodeCount, edgeCount };
    }));

    const edges = syncResult
      ? syncResult.links.map((link) => ({
          source: link.providerRepo,
          target: link.consumerRepo,
          contractName: link.providerContract,
          confidence: link.confidence,
          kind: 'contract' as const,
        }))
      : [];

    res.json({ repos, edges });
  });

  // ── Source preview ──────────────────────────────────────────────────────────
  // GET /api/v1/source?file=<path>&startLine=<n>&endLine=<n>
  app.get('/api/v1/source', requireAuth, requireRole('viewer'), (req: Request, res: Response) => {
    const { file, startLine: startLineStr, endLine: endLineStr, repo } = req.query as {
      file?: string;
      startLine?: string;
      endLine?: string;
      repo?: string;
    };

    if (!file) {
      res.status(400).json({
        error: {
          code: ErrorCodes.INVALID_REQUEST,
          message: 'Missing required query parameter: file',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Security: reject path traversal
    if (file.includes('../')) {
      res.status(400).json({
        error: {
          code: ErrorCodes.INVALID_REQUEST,
          message: 'Path traversal detected',
          hint: 'File paths must not contain "../"',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Determine base directory: prefer repo param, then workspaceRoot
    let baseDir = workspaceRoot;
    if (repo && repo !== repoName) {
      const registry = loadRegistry();
      const entry = registry.find((r) => r.name === repo || r.path === repo);
      if (entry) baseDir = entry.path;
    }

    // Security: must be within workspaceRoot or a known repo
    // Resolve relative paths against workspaceRoot first, then use path.relative
    // to safely detect escaping (handles prefix-collision like /repo vs /repo2).
    let rawResolved = path.normalize(file);
    if (!path.isAbsolute(rawResolved) && baseDir) {
      rawResolved = path.join(baseDir, rawResolved);
    }
    const resolvedFile = path.resolve(rawResolved);
    function isInsideDir(fileAbs: string, dir: string): boolean {
      const rel = path.relative(path.resolve(dir), fileAbs);
      return !rel.startsWith('..') && !path.isAbsolute(rel);
    }

    if (workspaceRoot) {
      if (!isInsideDir(resolvedFile, workspaceRoot)) {
        const registry = loadRegistry();
        const inKnownRepo = registry.some((r) => isInsideDir(resolvedFile, r.path));
        if (!inKnownRepo) {
          res.status(403).json({
            error: {
              code: ErrorCodes.FORBIDDEN,
              message: 'Access denied',
              hint: 'File path must be within an indexed repository',
              requestId: req.requestId,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }
      }
    } else {
      const registry = loadRegistry();
      const inKnownRepo = registry.some((r) => isInsideDir(resolvedFile, r.path));
      if (!inKnownRepo) {
        res.status(403).json({
          error: {
            code: ErrorCodes.FORBIDDEN,
            message: 'Access denied',
            hint: 'File path must be within an indexed repository',
            requestId: req.requestId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }
    }

    // Read file
    let fileContent: string;
    try {
      fileContent = fs.readFileSync(resolvedFile, 'utf-8');
    } catch {
      res.status(404).json({
        error: {
          code: ErrorCodes.NOT_FOUND,
          message: 'File not found',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const lines = fileContent.split('\n');

    const parsedStart = startLineStr ? Number.parseInt(startLineStr, 10) : 1;
    const parsedEnd   = endLineStr   ? Number.parseInt(endLineStr,   10) : parsedStart;
    if (!Number.isFinite(parsedStart) || parsedStart < 1 || !Number.isFinite(parsedEnd) || parsedEnd < 1) {
      res.status(400).json({
        error: {
          code: ErrorCodes.INVALID_REQUEST,
          message: 'Invalid startLine or endLine: must be positive integers',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    const startLine = Math.max(1, parsedStart);
    const endLine   = Math.min(lines.length, parsedEnd);

    // ±20 lines of context
    const contextStart = Math.max(1, startLine - 20);
    const contextEnd = Math.min(lines.length, endLine + 20);

    const content = lines.slice(contextStart - 1, contextEnd).join('\n');

    // Detect language from extension
    const ext = path.extname(resolvedFile).toLowerCase();
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.cs': 'csharp',
      '.cpp': 'cpp',
      '.cc': 'cpp',
      '.cxx': 'cpp',
      '.c': 'c',
      '.h': 'c',
      '.hpp': 'cpp',
      '.rb': 'ruby',
      '.php': 'php',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.kts': 'kotlin',
      '.json': 'json',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.md': 'markdown',
      '.sh': 'bash',
      '.bash': 'bash',
      '.zsh': 'bash',
      '.sql': 'sql',
      '.html': 'html',
      '.htm': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.less': 'less',
      '.xml': 'xml',
      '.toml': 'toml',
    };
    const language = languageMap[ext] ?? 'plaintext';

    res.json({
      content,
      language,
      startLine: contextStart,
      endLine: contextEnd,
    });
  });

  // ── GQL Query API ───────────────────────────────────────────────────────────
  // POST /api/v1/query — requires viewer role minimum
  app.post('/api/v1/query', requireRole('viewer'), async (req: Request, res: Response) => {
    const { gql, format } = req.body as { gql?: string; format?: string };
    if (!gql || typeof gql !== 'string') {
      res.status(400).json({
        error: { code: ErrorCodes.INVALID_REQUEST, message: 'Missing required field: gql', requestId: req.requestId, timestamp: new Date().toISOString() },
      });
      return;
    }
    try {
      const { parseGQL, isGQLParseError } = await import('../query/gql-parser.js');
      const { executeGQL } = await import('../query/gql-executor.js');
      const ast = parseGQL(gql);
      if (isGQLParseError(ast)) {
        res.status(422).json({
          error: {
            code: ErrorCodes.INVALID_REQUEST,
            message: `GQL parse error: ${ast.message}`,
            hint: `Position: ${ast.pos}${ast.expected ? `, expected: ${ast.expected}` : ''}${ast.got ? `, got: ${ast.got}` : ''}`,
            requestId: req.requestId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }
      const result = executeGQL(ast, graph);
      const statusCode = result.truncated ? 408 : 200;
      res.status(statusCode).json({ ...result, format: format ?? 'json' });
    } catch (err) {
      res.status(500).json({ error: { code: ErrorCodes.INTERNAL_ERROR, message: err instanceof Error ? err.message : String(err), requestId: req.requestId, timestamp: new Date().toISOString() } });
    }
  });

  // POST /api/v1/query/explain — returns a query plan
  app.post('/api/v1/query/explain', requireRole('viewer'), async (req: Request, res: Response) => {
    const { gql } = req.body as { gql?: string };
    if (!gql || typeof gql !== 'string') {
      res.status(400).json({
        error: { code: ErrorCodes.INVALID_REQUEST, message: 'Missing required field: gql', requestId: req.requestId, timestamp: new Date().toISOString() },
      });
      return;
    }
    try {
      const { parseGQL, isGQLParseError } = await import('../query/gql-parser.js');
      const ast = parseGQL(gql);
      if (isGQLParseError(ast)) {
        res.status(422).json({
          error: {
            code: ErrorCodes.INVALID_REQUEST,
            message: `GQL parse error: ${ast.message}`,
            hint: `Position: ${ast.pos}`,
            requestId: req.requestId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }
      // Build a query plan description
      const plan: Record<string, unknown> = { type: ast.type, gql };
      if (ast.type === 'FIND') {
        plan.steps = [
          { step: 1, op: 'SCAN_NODES', filter: ast.target === '*' ? 'all' : `kind=${ast.target}` },
          ...(ast.where ? [{ step: 2, op: 'WHERE', conditions: ast.where.exprs.length }] : []),
          ...(ast.limit !== undefined ? [{ step: 3, op: 'LIMIT', value: ast.limit }] : []),
        ];
        plan.estimatedCost = graph.size.nodes;
      } else if (ast.type === 'TRAVERSE') {
        plan.steps = [
          { step: 1, op: 'FIND_START_NODE', name: ast.from },
          { step: 2, op: 'BFS', edgeKind: ast.edgeKind, maxDepth: ast.depth ?? 5 },
        ];
        plan.estimatedCost = Math.min(graph.size.nodes, Math.pow(4, ast.depth ?? 5));
      } else if (ast.type === 'PATH') {
        plan.steps = [
          { step: 1, op: 'FIND_NODES', from: ast.from, to: ast.to },
          { step: 2, op: 'BFS_SHORTEST_PATH' },
        ];
        plan.estimatedCost = graph.size.nodes + graph.size.edges;
      } else if (ast.type === 'COUNT') {
        plan.steps = [
          { step: 1, op: 'SCAN_NODES', filter: ast.target === '*' ? 'all' : `kind=${ast.target}` },
          ...(ast.where ? [{ step: 2, op: 'WHERE', conditions: ast.where.exprs.length }] : []),
          ...(ast.groupBy ? [{ step: 3, op: 'GROUP_BY', property: ast.groupBy }] : [{ step: 3, op: 'COUNT' }]),
        ];
        plan.estimatedCost = graph.size.nodes;
      }
      res.json({ plan, graphSize: graph.size });
    } catch (err) {
      res.status(500).json({ error: { code: ErrorCodes.INTERNAL_ERROR, message: err instanceof Error ? err.message : String(err), requestId: req.requestId, timestamp: new Date().toISOString() } });
    }
  });

  // ── Web UI static files ─────────────────────────────────────────────────────
  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  }

  // ── Admin API — requires admin role ──────────────────────────────────────────
  app.use('/admin', requireRole('admin'));

  // List users
  app.get('/admin/users', (_req, res) => {
    const db = getOrCreateUsersDB();
    res.json({ users: db.listUsers() });
  });

  // Create user
  app.post('/admin/users', async (req: Request, res: Response) => {
    const { username, password, role } = req.body as { username?: string; password?: string; role?: string };
    if (!username || !password || !role) {
      res.status(400).json({ error: { code: ErrorCodes.INVALID_REQUEST, message: 'username, password, role required', requestId: req.requestId, timestamp: new Date().toISOString() } });
      return;
    }
    const validRoles: Role[] = ['admin', 'analyst', 'viewer', 'repo-owner'];
    if (!validRoles.includes(role as Role)) {
      res.status(400).json({ error: { code: ErrorCodes.INVALID_REQUEST, message: `role must be one of: ${validRoles.join(', ')}`, requestId: req.requestId, timestamp: new Date().toISOString() } });
      return;
    }
    const db = getOrCreateUsersDB();
    const user = db.createUser(username, password, role as Role);
    res.status(201).json({ user });
  });

  // Delete user
  app.delete('/admin/users/:username', (req: Request, res: Response) => {
    const { username } = req.params;
    const db = getOrCreateUsersDB();
    db.deleteUser(username as string);
    res.json({ message: `User ${username} deleted` });
  });

  // Set user role
  app.patch('/admin/users/:username/role', (req: Request, res: Response) => {
    const { username } = req.params;
    const { role } = req.body as { role?: string };
    const validRoles: Role[] = ['admin', 'analyst', 'viewer', 'repo-owner'];
    if (!role || !validRoles.includes(role as Role)) {
      res.status(400).json({ error: { code: ErrorCodes.INVALID_REQUEST, message: 'valid role required', requestId: req.requestId, timestamp: new Date().toISOString() } });
      return;
    }
    const db = getOrCreateUsersDB();
    db.setRole(username as string, role as Role);
    res.json({ message: `Role updated` });
  });

  // List tokens
  app.get('/admin/tokens', (_req, res) => {
    const db = getOrCreateUsersDB();
    res.json({ tokens: db.listTokens() });
  });

  // Revoke token
  app.delete('/admin/tokens/:id', (req: Request, res: Response) => {
    const db = getOrCreateUsersDB();
    db.revokeToken(req.params.id as string);
    res.json({ message: 'Token revoked' });
  });

  // Governance log
  app.get('/admin/governance/log', (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query['limit'] as string | undefined) ?? '100', 10), 1000);
    const entries = governanceLogger.readLog(limit);
    res.json({ entries, count: entries.length, enabled: governanceLogger.isEnabled() });
  });

  // ── CSRF error handler ──────────────────────────────────────────────────────
  app.use((err: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'EBADCSRFTOKEN') {
      res.status(403).json({
        error: {
          code: 'CI-1003',
          message: 'Invalid CSRF token',
          hint: 'Fetch a fresh CSRF token from GET /auth/csrf-token and include it as X-CSRF-Token header',
          requestId: (req as Request & { requestId?: string }).requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    next(err);
  });

  // ── Global error handler ────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const e = err as Error & { status?: number; statusCode?: number; type?: string };
    const statusCode = e.status ?? e.statusCode;
    // Express 5 throws a 404 Not Found for unmatched routes — handle silently
    if (statusCode === 404) {
      res.status(404).json({
        error: {
          code: ErrorCodes.NOT_FOUND,
          message: 'Not found',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    Logger.error('Unhandled error:', err.message);
    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
          hint: err.hint,
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    // body-parser errors carry a `status`/`statusCode` and a `type`.
    // Honor them so payload-too-large (413), bad JSON (400), etc. surface
    // with the correct HTTP status.
    const bodyParserStatus = statusCode;
    if (
      typeof bodyParserStatus === 'number' &&
      bodyParserStatus >= 400 &&
      bodyParserStatus < 500
    ) {
      const code =
        e.type === 'entity.too.large'
          ? ErrorCodes.PAYLOAD_TOO_LARGE
          : ErrorCodes.INVALID_REQUEST;
      const message =
        e.type === 'entity.too.large'
          ? 'Request payload too large (max 1MB)'
          : err.message;
      res.status(bodyParserStatus).json({
        error: {
          code,
          message,
          hint:
            e.type === 'entity.too.large'
              ? 'Reduce the request body size to under 1MB.'
              : undefined,
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    res.status(500).json({
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Internal server error',
        hint: 'Check server logs for details',
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
      },
    });
  });

  return app;
}

export interface HttpServerInstance {
  wsServer: import('./websocket-server.js').WsServer | null;
}

export async function startHttpServer(
  graph: KnowledgeGraph,
  repoName: string,
  port = 4747,
  workspaceRoot?: string,
  watcherState?: { watching: boolean; lastEventAt: number | null },
): Promise<HttpServerInstance> {
  // Bootstrap check
  const db = getOrCreateUsersDB();
  if (!db.hasAnyUser()) {
    console.log('\n  ⚠  No admin account found.');
    console.log('     Run: code-intel user create admin --role admin\n');
  }

  const app = createApp(graph, repoName, workspaceRoot, watcherState);

  return new Promise((resolve) => {
    const httpServer = app.listen(port, () => {
      Logger.info(`Code Intelligence server running at http://localhost:${port}`);
      Logger.info(`  Graph: ${graph.size.nodes} nodes, ${graph.size.edges} edges`);
      Logger.info(`  Auth: login at http://localhost:${port}/auth/login`);
      if (watcherState?.watching) {
        Logger.info(`  WebSocket: ws://localhost:${port}/ws (graph:updated push enabled)`);
      }

      // Start automated backup scheduler if enabled
      const scheduler = createBackupScheduler();
      scheduler.start(workspaceRoot);

      // Attach WebSocket server
      let wsServer: import('./websocket-server.js').WsServer | null = null;
      try {
        const { WsServer } = require('./websocket-server.js') as typeof import('./websocket-server.js');
        wsServer = new WsServer(httpServer as import('node:http').Server);
      } catch { /* ws not available in test env */ }

      resolve({ wsServer });
    }) as import('node:http').Server;
  });
}
