import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import type { Role } from './users-db.js';
import { getOrCreateUsersDB } from './users-db.js';
import { ErrorCodes } from '../errors/codes.js';
import { getSecret } from './secret-store.js';

// ── Augment Express request ───────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; username: string; role: Role; authMethod: 'session' | 'token'; scopedRepos?: string[]; scopedTools?: string[] };
      requestId?: string;
    }
  }
}

// ── Session store ─────────────────────────────────────────────────────────────

export interface SessionEntry {
  userId: string;
  username: string;
  role: Role;
  expiresAt: number;
  /** TTL used when this session was created — needed for correct cookie Max-Age. */
  ttlMs: number;
}

export const sessionStore = new Map<string, SessionEntry>();

const SESSION_COOKIE_NAME = 'code_intel_session';

/** Normal session TTL (default 8 h, overridable via CODE_INTEL_SESSION_TTL_HOURS). */
function getSessionTtlMs(): number {
  const hours = parseInt(process.env['CODE_INTEL_SESSION_TTL_HOURS'] ?? '8', 10);
  return (isNaN(hours) ? 8 : hours) * 60 * 60 * 1000;
}

/** "Remember me" TTL — always 12 hours regardless of env. */
const REMEMBER_ME_TTL_MS = 12 * 60 * 60 * 1000;

export function createSession(
  user: { id: string; username: string; role: Role },
  rememberMe = false,
): { sessionId: string; ttlMs: number } {
  const sessionId = uuidv4();
  const ttlMs = rememberMe ? REMEMBER_ME_TTL_MS : getSessionTtlMs();
  const expiresAt = Date.now() + ttlMs;
  sessionStore.set(sessionId, {
    userId: user.id,
    username: user.username,
    role: user.role,
    expiresAt,
    ttlMs,
  });
  return { sessionId, ttlMs };
}

export function getSession(sessionId: string): SessionEntry | null {
  const entry = sessionStore.get(sessionId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    sessionStore.delete(sessionId);
    return null;
  }
  // Slide the window: if more than 25% of the original TTL has elapsed, renew
  const remaining = entry.expiresAt - Date.now();
  if (remaining < entry.ttlMs * 0.75) {
    entry.expiresAt = Date.now() + entry.ttlMs;
  }
  return entry;
}

export function deleteSession(sessionId: string): void {
  sessionStore.delete(sessionId);
}

// ── Middleware: attach requestId ──────────────────────────────────────────────

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.requestId = uuidv4();
  res.setHeader('X-Request-ID', req.requestId);
  next();
}

// ── Helper: is localhost ──────────────────────────────────────────────────────

function isLocalhost(req: Request): boolean {
  const ip = req.ip ?? req.socket?.remoteAddress ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// ── Middleware: authenticate via session OR Bearer token ──────────────────────

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 1. Try session cookie
  const cookies = parseCookies(req.headers['cookie'] ?? '');
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (sessionId) {
    const session = getSession(sessionId);
    if (session) {
      req.user = { id: session.userId, username: session.username, role: session.role, authMethod: 'session' };
      // Refresh session cookie with the original TTL (sliding window)
      res.setHeader('Set-Cookie', buildSessionCookie(sessionId, session.ttlMs));
      next();
      return;
    }
  }

  // 2. Try Bearer token
  const authHeader = req.headers['authorization'] ?? '';
  if (authHeader.startsWith('Bearer ')) {
    const rawToken = authHeader.slice(7).trim();
    if (rawToken) {
      const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const db = getOrCreateUsersDB();
      const tokenRecord = db.findTokenByHash(hash);
      if (tokenRecord) {
        // Check rotation grace period — if this token was rotated, allow it
        // only until the grace expiry stored at rotate-grace:<id>.
        const graceKey = `rotate-grace:${tokenRecord.id}`;
        try {
          const graceExpiry = getSecret(graceKey);
          if (graceExpiry && new Date(graceExpiry) < new Date()) {
            // Grace period has elapsed — revoke immediately and deny
            setImmediate(() => db.revokeToken(tokenRecord.id));
            next();
            return;
          }
        } catch {
          /* secret store unavailable — proceed normally */
        }
        // Update last used asynchronously (fire-and-forget)
        setImmediate(() => db.updateLastUsed(tokenRecord.id));
        req.user = {
          id: tokenRecord.id,
          username: `token:${tokenRecord.name}`,
          role: tokenRecord.role,
          authMethod: 'token',
          scopedRepos: tokenRecord.scopedRepos,
          scopedTools: tokenRecord.scopedTools,
        };
        next();
        return;
      }
    }
  }

  // 3. Dev auto-login
  if (process.env['CODE_INTEL_DEV_AUTO_LOGIN'] === 'true' && isLocalhost(req)) {
    const db = getOrCreateUsersDB();
    const users = db.listUsers();
    if (users.length === 1 && users[0]!.role === 'admin') {
      const user = users[0]!;
      req.user = { id: user.id, username: user.username, role: user.role, authMethod: 'session' };
    }
  }

  next();
}

// ── Middleware: require authentication ────────────────────────────────────────

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      error: {
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Authentication required',
        hint: 'Provide Authorization: Bearer <token> header or login at /auth/login',
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }
  next();
}

// ── Middleware factory: require role ──────────────────────────────────────────

// ── Role hierarchy ─────────────────────────────────────────────────────────────

const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  'repo-owner': 2,
  analyst: 3,
  admin: 4,
};

function meetsRole(userRole: Role, required: Role): boolean {
  return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[required] ?? 0);
}

export function requireRole(
  ...roles: Role[]
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: ErrorCodes.UNAUTHORIZED,
          message: 'Authentication required',
          hint: 'Provide Authorization: Bearer <token> header or login at /auth/login',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    // Allow if user's role meets ANY of the required roles (by rank)
    const allowed = roles.some((r) => meetsRole(req.user!.role, r));
    if (!allowed) {
      res.status(403).json({
        error: {
          code: ErrorCodes.FORBIDDEN,
          message: 'Insufficient permissions',
          hint: 'Your role does not have access to this resource',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    next();
  };
}

// ── Middleware factory: require repo access ───────────────────────────────────

export function requireRepoAccess(
  getRepoId: (req: Request) => string | undefined,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: ErrorCodes.UNAUTHORIZED,
          message: 'Authentication required',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    // Admin and analyst have access to all repos
    if (req.user.role === 'admin' || req.user.role === 'analyst') {
      next();
      return;
    }
    // Check token repo scoping
    if (req.user.authMethod === 'token' && req.user.scopedRepos && req.user.scopedRepos.length > 0) {
      const repoId = getRepoId(req);
      if (repoId && !req.user.scopedRepos.includes(repoId)) {
        res.status(403).json({
          error: {
            code: ErrorCodes.FORBIDDEN,
            message: 'Token does not have access to this repository',
            hint: `This token is scoped to: ${req.user.scopedRepos.join(', ')}`,
            requestId: req.requestId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }
    }
    next();
  };
}

export function requireToolScope(
  toolName: string,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: ErrorCodes.UNAUTHORIZED,
          message: 'Authentication required',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    // No tool scoping set → allow all
    if (!req.user.scopedTools || req.user.scopedTools.length === 0) {
      next();
      return;
    }
    if (!req.user.scopedTools.includes(toolName)) {
      res.status(403).json({
        error: {
          code: ErrorCodes.FORBIDDEN,
          message: `Token does not have access to tool: ${toolName}`,
          hint: `This token is scoped to tools: ${req.user.scopedTools.join(', ')}`,
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    next();
  };
}

export function parseCookies(cookieHeader: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const [key, ...vals] = part.trim().split('=');
    if (key) result[key.trim()] = decodeURIComponent(vals.join('=').trim());
  }
  return result;
}

// ── Cookie helpers (used in app.ts auth routes) ───────────────────────────────

export function buildSessionCookie(sessionId: string, ttlMs?: number): string {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const maxAge = Math.floor((ttlMs ?? getSessionTtlMs()) / 1000);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    `HttpOnly`,
    `Max-Age=${maxAge}`,
    `Path=/`,
    `SameSite=${isProduction ? 'Strict' : 'Lax'}`,
  ];
  if (isProduction) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax`;
}

// ── Re-export bcrypt verify for use in auth routes ────────────────────────────

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
